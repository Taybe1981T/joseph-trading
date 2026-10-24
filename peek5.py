p = r"C:\Users\taybe kraa\Desktop\Joseph.Trading\src\components\mobile\MobileNewTrade.tsx"
lines = open(p, encoding="utf-8").read().splitlines()
out = []
for i in range(60, 130):
    out.append(str(i+1) + " " + lines[i])
open("peek5out.txt", "w", encoding="utf-8").write("\n".join(out))
