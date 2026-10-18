"""Native folder chooser, invoked only by an explicit local UI button."""
import json
import sys
try:
    import tkinter as tk
    from tkinter import filedialog
    root = tk.Tk()
    root.withdraw()
    root.attributes('-topmost', True)
    folder = filedialog.askdirectory(title='음원과 이미지가 있는 작업 폴더 선택', mustexist=True)
    root.destroy()
    print(json.dumps({'folder': folder}, ensure_ascii=False))
except Exception as error:
    print('폴더 선택 창을 열 수 없습니다. 탐색기에서 폴더 경로를 복사해 입력해 주세요. ' + str(error), file=sys.stderr)
    sys.exit(1)
