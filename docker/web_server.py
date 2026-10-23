#!/usr/bin/env python3
"""Serve o bundle web exportado do Expo, com fallback de SPA.

O painel abre o app em http://<host>:8085/?demoSession=... e o expo-router
resolve as rotas no navegador. Um caminho sem arquivo correspondente precisa
receber o index.html (e não 404), para que recarregar /home, /perfil etc.
continue funcionando. Arquivos com extensão que não existem continuam 404.
"""

import argparse
import mimetypes
import os
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

mimetypes.add_type("application/javascript", ".js")
mimetypes.add_type("text/css", ".css")
mimetypes.add_type("font/woff2", ".woff2")
mimetypes.add_type("font/ttf", ".ttf")
mimetypes.add_type("image/svg+xml", ".svg")


class SpaHandler(SimpleHTTPRequestHandler):
    server_version = "CooperativaDemoWeb/1.0"

    def send_head(self):
        caminho = self.translate_path(self.path)
        if not os.path.exists(caminho):
            if os.path.splitext(caminho)[1]:
                self.send_error(404)
                return None
            self.path = "/index.html"
        elif os.path.isdir(caminho) and not os.path.exists(
            os.path.join(caminho, "index.html")
        ):
            self.path = "/index.html"
        return super().send_head()

    def log_message(self, fmt, *args):
        print("[web] " + (fmt % args), flush=True)


def main():
    parser = argparse.ArgumentParser(description="Serve o app web da demo.")
    parser.add_argument("--port", type=int, default=8085)
    parser.add_argument("--bind", default="0.0.0.0")
    parser.add_argument("--root", default="/app/web")
    args = parser.parse_args()

    server = ThreadingHTTPServer(
        (args.bind, args.port), partial(SpaHandler, directory=args.root)
    )
    print(f"[web] app web em http://{args.bind}:{args.port} (root: {args.root})", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
