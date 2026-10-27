# Локальный сервер для разработки: как `python -m http.server`, но без кэша браузера.
# Иначе Chrome держит старые ES-модули (src/*.js) и правки не видны даже после Ctrl+F5.
# Запуск из папки проекта:  python tools/serve.py [порт=8000]
import http.server, os, sys

class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Expires", "0")
        super().end_headers()

if __name__ == "__main__":
    os.chdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    print(f"Путь к бессмертию: http://localhost:{port}  (без кэша, Ctrl+C — стоп)")
    http.server.ThreadingHTTPServer(("", port), NoCache).serve_forever()
