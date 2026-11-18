# -*- coding: utf-8 -*-
"""
serve.py —— 本地预览服务（带写盘能力）

python -m http.server 只能读不能写，校准页的「保存」按钮就没有落点。
这个脚本在它基础上加了一个 POST /__save：把请求体直接写成 face.json。

用法：
  python tools/serve.py           # 默认 8777
  python tools/serve.py 9000      # 换端口
"""

import json
import os
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def do_POST(self):
        # 页面把"自己在哪"放进路径：/__save 表示根目录，
        # /sub/dir/__save 表示写 sub/dir/face.json。
        # 这样一个服务能同时伺候多个角色目录，不会互相覆盖。
        if not self.path.endswith('/__save'):
            self.send_error(404)
            return
        rel = self.path[: -len('__save')].lstrip('/')
        target_dir = os.path.normpath(os.path.join(ROOT, rel))
        if not target_dir.startswith(ROOT):
            self.send_error(403, 'out of root')
            return

        try:
            n = int(self.headers.get('Content-Length', 0))
            raw = self.rfile.read(n)
            data = json.loads(raw.decode('utf-8'))
        except Exception:
            self.send_error(400, 'bad json')
            return

        if not os.path.isdir(target_dir):
            self.send_error(404, 'no such dir')
            return
        target = os.path.join(target_dir, 'face.json')
        with open(target, 'w', encoding='utf-8') as fh:
            json.dump(data, fh, ensure_ascii=False, indent=2)

        body = '已保存'.encode('utf-8')
        self.send_response(200)
        self.send_header('Content-Type', 'text/plain; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def end_headers(self):
        # 调参期间永远拿最新的 js/html，避免"改了没生效"这种假象
        if not self.path.startswith('/__'):
            self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def log_message(self, fmt, *args):
        pass


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8777
    srv = ThreadingHTTPServer(('127.0.0.1', port), Handler)
    print('服务已启动： http://127.0.0.1:%d/index.html' % port)
    print('校准五官：   http://127.0.0.1:%d/calibrate.html' % port)
    print('根目录：     %s' % ROOT)
    print('关掉这个窗口就停止服务。')
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
