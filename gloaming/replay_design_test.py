"""Launch the optional replay design using the existing recording daemon."""
from __future__ import annotations

import argparse
import json
import socket
import subprocess
import sys
from urllib.parse import urlparse


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', action='store_true', help='Print the test URL instead of opening the overlay')
    parser.add_argument('--controller', action='store_true', help='Start with controller hints')
    args = parser.parse_args()
    try:
        with socket.socket(socket.AF_UNIX) as client:
            client.settimeout(5)
            client.connect('/tmp/gloaming/gloaming.sock')
            client.sendall(b'status\n')
            data = b''
            while b'\n' not in data:
                chunk = client.recv(65536)
                if not chunk:
                    break
                data += chunk
        status = json.loads(data)
        url = urlparse(status['local_url'])
        if url.hostname != '127.0.0.1' or not url.port:
            raise ValueError('Local recording server is unavailable')
    except (OSError, ValueError, KeyError) as error:
        print(f'Start Gloaming first with sh run-dev.sh, then run this launcher again.\n{error}', file=sys.stderr)
        return 1
    if args.url:
        print(f'http://127.0.0.1:{url.port}/?replayOverlay=1&overlayDesign=test' + ('&controller=1' if args.controller else ''))
        return 0
    print('Opening Replay Lab. Saving creates a real clip. Closing this window leaves recording running.', flush=True)
    command = [sys.executable, '-I', '-m', 'gloaming.replay_overlay', str(url.port), '--design-test']
    if args.controller:
        command.append('--controller')
    # The native host watches its parent's pipe. Keep it open until this test ends.
    child = subprocess.Popen(command, stdin=subprocess.PIPE, start_new_session=True)
    try:
        return child.wait()
    except KeyboardInterrupt:
        return 0
    finally:
        if child.stdin:
            child.stdin.close()
        if child.poll() is None:
            try:
                child.wait(timeout=3)
            except subprocess.TimeoutExpired:
                child.terminate()
                child.wait(timeout=3)


if __name__ == '__main__':
    raise SystemExit(main())
