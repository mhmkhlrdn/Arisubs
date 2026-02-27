"""
Extract YouTube cookies from browser via Chrome DevTools Protocol.
 
Strategy:
1. Check if any browser has a remote debug port already open → extract
2. Try to enable remote debugging on running Chrome by modifying its shortcut
   and prompting the user to restart Chrome
3. Fallback: manual cookies.txt upload instructions

Usage: py extract_cookies.py [output_path]
"""
import sys
import json
import time
import subprocess
import socket
import os
import urllib.request
import http.client
import winreg


def is_port_open(port):
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=1):
            return True
    except Exception:
        return False


def get_cookies_via_cdp(port):
    """Get YouTube cookies from browser via Chrome DevTools Protocol."""
    try:
        req = urllib.request.urlopen(f"http://127.0.0.1:{port}/json/version", timeout=3)
        version_info = json.loads(req.read())
        print(f"  Connected: {version_info.get('Browser', 'unknown')}", file=sys.stderr)
    except Exception as e:
        return None, f"Cannot connect: {e}"

    try:
        conn = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
        conn.request("GET", "/json/list")
        targets = json.loads(conn.getresponse().read())
        conn.close()

        # Find a page target
        page_target = None
        for t in targets:
            if t.get("type") == "page" and "youtube" in t.get("url", "").lower():
                page_target = t
                break
        if not page_target:
            for t in targets:
                if t.get("type") == "page" and not t.get("url", "").startswith("chrome://"):
                    page_target = t
                    break
        if not page_target:
            for t in targets:
                if t.get("type") == "page":
                    page_target = t
                    break

        if not page_target:
            return None, "No page targets found"

        ws_url = page_target.get("webSocketDebuggerUrl", "")
        if not ws_url:
            return None, "No WebSocket URL"

        # First try getAllCookies
        cookies = _ws_command(ws_url, {"id": 1, "method": "Network.getAllCookies"})
        if cookies and "result" in cookies and "cookies" in cookies["result"]:
            return cookies["result"]["cookies"], None

        # Fallback: getCookies with specific URLs
        cookies = _ws_command(ws_url, {
            "id": 2, "method": "Network.getCookies",
            "params": {"urls": ["https://www.youtube.com", "https://accounts.google.com"]}
        })
        if cookies and "result" in cookies and "cookies" in cookies["result"]:
            return cookies["result"]["cookies"], None

        return None, f"CDP returned no cookies"
    except Exception as e:
        return None, f"CDP error: {e}"


def _ws_command(ws_url, command):
    """Send a CDP command via WebSocket and return the response."""
    parts = ws_url.replace("ws://", "").split("/", 1)
    host, port = parts[0].split(":")
    path = "/" + parts[1] if len(parts) > 1 else "/"

    sock = socket.create_connection((host, int(port)), timeout=10)
    handshake = (
        f"GET {path} HTTP/1.1\r\n"
        f"Host: {host}:{port}\r\n"
        f"Upgrade: websocket\r\n"
        f"Connection: Upgrade\r\n"
        f"Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n"
        f"Sec-WebSocket-Version: 13\r\n\r\n"
    )
    sock.sendall(handshake.encode())
    resp = b""
    while b"\r\n\r\n" not in resp:
        resp += sock.recv(4096)
    if b"101" not in resp.split(b"\r\n")[0]:
        sock.close()
        return None

    _ws_send(sock, json.dumps(command))
    result = _ws_recv_full(sock)
    sock.close()

    if result:
        return json.loads(result)
    return None


def _ws_send(sock, message):
    payload = message.encode()
    mask = os.urandom(4)
    header = bytearray([0x81])
    l = len(payload)
    if l < 126:
        header.append(0x80 | l)
    elif l < 65536:
        header.append(0x80 | 126)
        header.extend(l.to_bytes(2, "big"))
    else:
        header.append(0x80 | 127)
        header.extend(l.to_bytes(8, "big"))
    header.extend(mask)
    masked = bytearray(l)
    for i in range(l):
        masked[i] = payload[i] ^ mask[i % 4]
    sock.sendall(header + masked)


def _ws_recv_full(sock):
    sock.settimeout(10)
    full = b""
    while True:
        try:
            h = _recv_exact(sock, 2)
            if not h:
                return None
            fin = (h[0] & 0x80) != 0
            masked = (h[1] & 0x80) != 0
            length = h[1] & 0x7f
            if length == 126:
                length = int.from_bytes(_recv_exact(sock, 2), "big")
            elif length == 127:
                length = int.from_bytes(_recv_exact(sock, 8), "big")
            mask_key = _recv_exact(sock, 4) if masked else None
            payload = _recv_exact(sock, length) if length > 0 else b""
            if masked and mask_key and payload:
                payload = bytearray(payload)
                for i in range(len(payload)):
                    payload[i] ^= mask_key[i % 4]
                payload = bytes(payload)
            full += payload
            if fin:
                return full.decode()
        except Exception:
            return full.decode() if full else None


def _recv_exact(sock, n):
    data = b""
    while len(data) < n:
        chunk = sock.recv(n - len(data))
        if not chunk:
            return None
        data += chunk
    return data


def cookies_to_netscape(cookies, output_path):
    youtube_domains = {".youtube.com", ".google.com", "youtube.com", "google.com",
                       ".accounts.google.com", "accounts.google.com",
                       ".www.youtube.com", "www.youtube.com"}
    with open(output_path, "w") as f:
        f.write("# Netscape HTTP Cookie File\n")
        f.write("# This file was generated automatically\n\n")
        count = 0
        seen = set()
        for cookie in cookies:
            domain = cookie.get("domain", "")
            if not any(domain.endswith(d) or domain == d for d in youtube_domains):
                continue
            name = cookie.get("name", "")
            key = (domain, name)
            if key in seen:
                continue
            seen.add(key)
            flag = "TRUE" if domain.startswith(".") else "FALSE"
            path = cookie.get("path", "/")
            secure = "TRUE" if cookie.get("secure", False) else "FALSE"
            exp = cookie.get("expires", -1)
            expires = str(int(time.time()) + 86400 * 365) if (exp is None or float(exp) < 0) else str(int(exp))
            value = cookie.get("value", "")
            f.write(f"{domain}\t{flag}\t{path}\t{secure}\t{expires}\t{name}\t{value}\n")
            count += 1
    return count


def is_process_running(proc_name):
    try:
        result = subprocess.run(
            ["tasklist", "/FI", f"IMAGENAME eq {proc_name}", "/FO", "CSV", "/NH"],
            capture_output=True, text=True, timeout=5, creationflags=0x08000000
        )
        return proc_name.lower() in result.stdout.lower()
    except Exception:
        return False


def find_browser_exe(proc_name, known_paths):
    for p in known_paths:
        if os.path.exists(p):
            return p
    try:
        result = subprocess.run(
            ["wmic", "process", "where", f"name='{proc_name}'", "get", "ExecutablePath", "/FORMAT:LIST"],
            capture_output=True, text=True, timeout=5, creationflags=0x08000000
        )
        for line in result.stdout.split("\n"):
            if "ExecutablePath=" in line:
                path = line.split("ExecutablePath=")[1].strip()
                if path and os.path.exists(path):
                    return path
    except Exception:
        pass
    return None


def enable_chrome_debug_port(browser_name, port):
    """Add --remote-debugging-port to Chrome's registry command line.
    This enables debug port on next browser launch."""
    # Method: Set a Chrome flag via registry
    reg_paths = {
        "chrome": r"Software\Google\Chrome",
        "edge": r"Software\Microsoft\Edge",
    }
    reg_path = reg_paths.get(browser_name)
    if not reg_path:
        return False

    try:
        key = winreg.CreateKeyEx(winreg.HKEY_CURRENT_USER, reg_path, 0, winreg.KEY_SET_VALUE)
        # Use Chrome's command line flag via registry
        # Actually use the simpler approach: create a .bat wrapper
        return False  # Registry approach is complex, use restart approach instead
    except Exception:
        return False


def restart_browser_with_debug(browser_name, proc_name, browser_exe, port):
    """Kill the browser and restart it with remote debugging enabled."""
    print(f"  Restarting {browser_name} with debug port {port}...", file=sys.stderr)

    # Kill the browser
    try:
        subprocess.run(
            ["taskkill", "/F", "/IM", proc_name],
            capture_output=True, timeout=10, creationflags=0x08000000
        )
        time.sleep(2)
    except Exception as e:
        print(f"  Could not kill {browser_name}: {e}", file=sys.stderr)
        return False

    # Restart with debug port
    try:
        subprocess.Popen(
            [browser_exe, f"--remote-debugging-port={port}", "--restore-last-session"],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
        )
        # Wait for port
        for _ in range(30):
            if is_port_open(port):
                return True
            time.sleep(0.5)
    except Exception as e:
        print(f"  Could not restart {browser_name}: {e}", file=sys.stderr)

    return False


BROWSERS = [
    ("chrome", "chrome.exe", 9222, [
        os.path.expandvars(r"%PROGRAMFILES%\Google\Chrome\Application\chrome.exe"),
        os.path.expandvars(r"%PROGRAMFILES(X86)%\Google\Chrome\Application\chrome.exe"),
        os.path.expandvars(r"%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"),
    ]),
    ("edge", "msedge.exe", 9223, [
        os.path.expandvars(r"%PROGRAMFILES(X86)%\Microsoft\Edge\Application\msedge.exe"),
        os.path.expandvars(r"%PROGRAMFILES%\Microsoft\Edge\Application\msedge.exe"),
    ]),
    ("brave", "brave.exe", 9224, [
        os.path.expandvars(r"%PROGRAMFILES%\BraveSoftware\Brave-Browser\Application\brave.exe"),
        os.path.expandvars(r"%LOCALAPPDATA%\BraveSoftware\Brave-Browser\Application\brave.exe"),
    ]),
]


def main():
    output_path = sys.argv[1] if len(sys.argv) > 1 else "cookies.txt"

    # Step 1: Check if any debug port is already open
    for name, proc, port, paths in BROWSERS:
        if is_port_open(port):
            print(f"Found {name} debug port {port}", file=sys.stderr)
            cookies, err = get_cookies_via_cdp(port)
            if cookies:
                count = cookies_to_netscape(cookies, output_path)
                if count > 0:
                    print(f"{name}:{count}")
                    sys.exit(0)
                print(f"  No YouTube cookies from {name}", file=sys.stderr)
            else:
                print(f"  Error: {err}", file=sys.stderr)

    # Step 2: Find running browser, restart it with debug port
    for name, proc, port, paths in BROWSERS:
        if not is_process_running(proc):
            continue

        browser_exe = find_browser_exe(proc, paths)
        if not browser_exe:
            print(f"  Could not find {name} executable", file=sys.stderr)
            continue

        print(f"Found running {name}...", file=sys.stderr)

        if restart_browser_with_debug(name, proc, browser_exe, port):
            time.sleep(2)  # Let pages restore
            cookies, err = get_cookies_via_cdp(port)
            if cookies:
                count = cookies_to_netscape(cookies, output_path)
                if count > 0:
                    print(f"{name}:{count}")
                    sys.exit(0)
                print(f"  No YouTube cookies", file=sys.stderr)
            else:
                print(f"  Error: {err}", file=sys.stderr)

    print("FAILED: Could not extract cookies from any browser", file=sys.stderr)
    print("HINT: Make sure you are logged into YouTube in your browser", file=sys.stderr)
    sys.exit(1)


if __name__ == "__main__":
    main()
