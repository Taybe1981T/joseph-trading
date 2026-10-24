p = r"C:\Users\taybe kraa\Desktop\Joseph.Trading\src\components\mobile\MobilePositions.tsx"
lines = open(p, encoding="utf-8").read().splitlines()
out = []
for i in range(103, 135):
    out.append(str(i+1) + " " + lines[i])
open("peek4out.txt", "w", encoding="utf-8").write("\n".join(out))
