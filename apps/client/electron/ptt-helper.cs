using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Threading;

class PttHelper {
    [DllImport("user32.dll")]
    static extern short GetAsyncKeyState(int vKey);

    static void Main(string[] args) {
        if (args.Length == 0) return;
        
        List<int> keys = new List<int>();
        foreach (var arg in args) {
            int k;
            if (int.TryParse(arg, out k) && k > 0) {
                keys.Add(k);
            }
        }
        if (keys.Count == 0) return;

        bool wasDown = false;

        while (true) {
            bool isDown = false;
            for (int i = 0; i < keys.Count; i++) {
                if ((GetAsyncKeyState(keys[i]) & 0x8000) != 0) {
                    isDown = true;
                    break;
                }
            }

            if (isDown != wasDown) {
                wasDown = isDown;
                Console.WriteLine(isDown ? "DOWN" : "UP");
                Console.Out.Flush();
            }

            Thread.Sleep(10);
        }
    }
}
