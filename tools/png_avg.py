import struct, zlib, sys, os

def avg_color(path):
    with open(path, 'rb') as f:
        data = f.read()
    assert data[:8] == b'\x89PNG\r\n\x1a\n', 'not a png'
    pos = 8
    idat = b''
    w = h = bitdepth = colortype = None
    while pos < len(data):
        ln = struct.unpack('>I', data[pos:pos+4])[0]
        typ = data[pos+4:pos+8]
        chunk = data[pos+8:pos+8+ln]
        if typ == b'IHDR':
            w, h, bitdepth, colortype = struct.unpack('>IIBB', chunk[:10])
        elif typ == b'IDAT':
            idat += chunk
        pos += 12 + ln
    raw = zlib.decompress(idat)
    ch = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[colortype]
    stride = w * ch
    out = bytearray(w * h * ch)
    prev = bytearray(stride)
    p = 0
    for y in range(h):
        ft = raw[p]; p += 1
        line = bytearray(raw[p:p+stride]); p += stride
        if ft == 1:
            for i in range(ch, stride): line[i] = (line[i] + line[i-ch]) & 255
        elif ft == 2:
            for i in range(stride): line[i] = (line[i] + prev[i]) & 255
        elif ft == 3:
            for i in range(stride):
                a = line[i-ch] if i >= ch else 0
                b = prev[i]
                line[i] = (line[i] + ((a + b) >> 1)) & 255
        elif ft == 4:
            for i in range(stride):
                a = line[i-ch] if i >= ch else 0
                b = prev[i]
                c = prev[i-ch] if i >= ch else 0
                pa, pb, pc = abs(b-c), abs(a-c), abs(a+b-2*c)
                pr = a if pa <= pb and pa <= pc else (b if pb <= pc else c)
                line[i] = (line[i] + pr) & 255
        out[y*stride:(y+1)*stride] = line
        prev = line
    # средний цвет
    n = w * h
    if ch >= 3:
        rs = sum(out[i] for i in range(0, len(out), ch))
        gs = sum(out[i] for i in range(1, len(out), ch))
        bs = sum(out[i] for i in range(2, len(out), ch))
        r, g, b = rs//n, gs//n, bs//n
    else:
        r = g = b = sum(out)//n
    lum = (r*299 + g*587 + b*114) // 1000
    return w, h, (r, g, b), lum

for name in sorted(os.listdir(sys.argv[1])):
    p = os.path.join(sys.argv[1], name)
    if name.lower().endswith('.png'):
        w, h, (r, g, b), lum = avg_color(p)
        print(f'{name}: {w}x{h} avg=({r},{g},{b}) lum={lum}')
