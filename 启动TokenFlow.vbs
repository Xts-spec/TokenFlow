Set ws = CreateObject("WScript.Shell")
ws.CurrentDirectory = "D:\code\TokenFlow\release\win-unpacked"
ws.Run """D:\code\TokenFlow\release\win-unpacked\TokenFlow.exe""", 1, False
