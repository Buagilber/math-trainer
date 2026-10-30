# Локальний сервер для розробки: як `python3 -m http.server`, але забороняє
# кешування, щоб браузер завжди брав свіжі модулі після змін у коді.
#
# Запуск: python3 tools/serve.py [порт] [--delay МС] [--fail]
#   --delay 8000  — кожна відповідь затримується (імітація повільної мережі);
#   --fail        — кожен запит отримує 503 (імітація збою сервера).
# Режими потрібні, щоб перевірити, як service worker (sw.js) переживає погану мережу.

import argparse
import http.server
import os
import time


def make_handler(delay_ms, fail):
    class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
        def end_headers(self):
            self.send_header('Cache-Control', 'no-store')
            super().end_headers()

        def do_GET(self):
            if delay_ms:
                time.sleep(delay_ms / 1000)
            if fail:
                self.send_error(503, 'Simulated server failure')  # рядок статусу HTTP — лише латиницею
                return
            super().do_GET()

    return NoCacheHandler


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('port', nargs='?', type=int, default=8765)
    parser.add_argument('--delay', type=int, default=0, help='затримка кожної відповіді, мс')
    parser.add_argument('--fail', action='store_true', help='відповідати 503 на всі запити')
    args = parser.parse_args()
    os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
    server = http.server.ThreadingHTTPServer(('127.0.0.1', args.port), make_handler(args.delay, args.fail))
    server.serve_forever()
