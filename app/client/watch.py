import time, os

from watchdog.events import FileSystemEvent, FileSystemEventHandler
from watchdog.observers import Observer

import http.server
from http.server import HTTPStatus
from functools import partial
import urllib
import io
from collections import namedtuple
FakeStat = namedtuple("FakeStat", "st_mtime a b c d e length")

class LBC:
    def __init__(self):
        self.lbc = 0

class MyHttpHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, lbc=None, **kwargs):
        self._lbc = lbc
        super().__init__(*args, **kwargs)

    def do_GET(self):
        if self.path == "/py-live-reload":
            self.live_reload_stream()
        else:
            super().do_GET()

    def live_reload_stream(self):
        # we write headers, then write an event stream and never return
        self.send_response(HTTPStatus.OK)
        self.send_header("X-Accel-Buffering", "no");
        self.send_header("Content-Type", "text/event-stream");
        self.send_header("Cache-Control", "no-cache");
        self.end_headers()
        last_lbc = 0
        while True:
            if self._lbc.lbc != last_lbc and last_lbc != 0:
                self.wfile.write("event: change\n".encode("utf-8"))
                self.wfile.write(f"data: {self._lbc.lbc}\n".encode("utf-8"))
                self.wfile.write('\n'.encode("utf-8"))
                last_lbc = self._lbc.lbc
            else:
                last_lbc = self._lbc.lbc
            time.sleep(1)

    def send_head(self):
        """Sigh. We have to copy this whole function to override one line."""
        path = self.translate_path(self.path)
        f = None
        if os.path.isdir(path):
            parts = urllib.parse.urlsplit(self.path)
            if not parts.path.endswith('/'):
                # redirect browser - doing basically what apache does
                self.send_response(HTTPStatus.MOVED_PERMANENTLY)
                new_parts = (parts[0], parts[1], parts[2] + '/',
                             parts[3], parts[4])
                new_url = urllib.parse.urlunsplit(new_parts)
                self.send_header("Location", new_url)
                self.send_header("Content-Length", "0")
                self.end_headers()
                return None
            for index in self.index_pages:
                index = os.path.join(path, index)
                if os.path.isfile(index):
                    path = index
                    break
            else:
                return self.list_directory(path)
        ctype = self.guess_type(path)
        # check for trailing "/" which should return 404. See Issue17324
        # The test for this was added in test_httpserver.py
        # However, some OS platforms accept a trailingSlash as a filename
        # See discussion on python-dev and Issue34711 regarding
        # parsing and rejection of filenames with a trailing slash
        if path.endswith("/"):
            self.send_error(HTTPStatus.NOT_FOUND, "File not found")
            return None

        try:
            f = open(path, 'rb')
        except OSError:
            self.send_error(HTTPStatus.NOT_FOUND, "File not found")
            return None


        try:
            ####################################################################
            #  Our change. We had to copy the whole function just to do this.  #
            ####################################################################
            if path == "_build/index.html":
                nf = io.BytesIO()
                self.copyfile(f, nf)
                # add our extra code to the index.html file to do live reload
                nf.write('''
                <script>
                new EventSource('/py-live-reload').addEventListener('change', () => {
                    location.reload()
                })
                </script>
                '''.encode("utf-8"))
                nf.seek(0)
                f = nf
                fs = FakeStat(st_mtime=int(time.time()),
                a=0,b=0,c=0,d=0,e=0, length=f.getbuffer().nbytes)
            elif path == "_build/py-live-reload":
                return # shouldn't get here with this; it's caught in do_GET
            else:
                ####################
                #  End our change  #
                ####################
                fs = os.fstat(f.fileno())
            # Use browser cache if possible
            if ("If-Modified-Since" in self.headers
                    and "If-None-Match" not in self.headers):
                # compare If-Modified-Since and time of last file modification
                try:
                    ims = email.utils.parsedate_to_datetime(
                        self.headers["If-Modified-Since"])
                except (TypeError, IndexError, OverflowError, ValueError):
                    # ignore ill-formed values
                    pass
                else:
                    if ims.tzinfo is None:
                        # obsolete format with no timezone, cf.
                        # https://tools.ietf.org/html/rfc7231#section-7.1.1.1
                        ims = ims.replace(tzinfo=datetime.timezone.utc)
                    if ims.tzinfo is datetime.timezone.utc:
                        # compare to UTC datetime of last modification
                        last_modif = datetime.datetime.fromtimestamp(
                            fs.st_mtime, datetime.timezone.utc)
                        # remove microseconds, like in If-Modified-Since
                        last_modif = last_modif.replace(microsecond=0)

                        if last_modif <= ims:
                            self.send_response(HTTPStatus.NOT_MODIFIED)
                            self.end_headers()
                            f.close()
                            return None

            self.send_response(HTTPStatus.OK)
            self.send_header("Content-type", ctype)
            self.send_header("Content-Length", str(fs[6]))
            self.send_header("Last-Modified",
                self.date_time_string(fs.st_mtime))
            self.end_headers()
            return f
        except:
            f.close()
            raise



PORT = 5173
lbc = LBC()
lbc.lbc = time.time()
Handler = partial(MyHttpHandler, directory="_build", lbc=lbc)

class MyFSHandler(FileSystemEventHandler):
    def __init__(self, *args, **kwargs):
        self.__last_build_time = 0
        super().__init__(*args, **kwargs)

    def on_any_event(self, event: FileSystemEvent) -> None:
        if "/_build" in event.src_path: return # ignore built changes
        if event.is_directory: return # only look at files
        if event.event_type != "closed": return # wait until file is closed
        now = time.time()
        if now - self.__last_build_time < 2: return # don't rebuild repeatedly
        self.__last_build_time = now
        print("Rebuilding")
        os.system("node build.js")
        lbc.lbc = time.time()

event_handler = MyFSHandler()
observer = Observer()
observer.schedule(event_handler, ".", recursive=True)
observer.start()
try:
    with http.server.ThreadingHTTPServer(("", PORT), Handler) as httpd:
        print(f"Serving at port {PORT}")
        # Start the server and keep it running until you stop the script
        httpd.serve_forever()
finally:
    observer.stop()
    observer.join()
