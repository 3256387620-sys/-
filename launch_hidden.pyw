# -*- coding: utf-8 -*-
"""无窗口启动器：给 web_server.py 挂上日志文件输出，再由 pythonw.exe 静默运行。

pythonw.exe 下 sys.stdout 为 None，web_server.py 里的 print() 会抛
AttributeError 直接退出；这里先把 stdout/stderr 重定向到 server.log，
再用 runpy 以 __main__ 身份执行原文件，源码本身不做任何改动。
"""
import os
import runpy
import sys

BASE = os.path.dirname(os.path.abspath(__file__))
os.chdir(BASE)

_log = open(os.path.join(BASE, "server.log"), "a", encoding="utf-8", errors="replace")
sys.stdout = _log
sys.stderr = _log

sys.argv = [os.path.join(BASE, "web_server.py")]
runpy.run_path(sys.argv[0], run_name="__main__")
