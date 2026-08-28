import sys, re, base64, zlib, urllib.parse

def decode(path):
    data = open(path, encoding="utf-8").read()
    m = re.search(r"<diagram[^>]*>(.*?)</diagram>", data, re.S)
    if not m:
        print("NO DIAGRAM TAG"); return
    payload = m.group(1).strip()
    raw = base64.b64decode(payload)
    try:
        inflated = zlib.decompress(raw, -15)
    except Exception as e:
        print("inflate err", e); return
    xml = urllib.parse.unquote(inflated.decode("utf-8"))
    print(xml)

def encode(inpath, outpath):
    # inpath: a plain mxGraphModel xml file; produce compressed .drawio (mxfile)
    xml = open(inpath, encoding="utf-8").read().strip()
    quoted = urllib.parse.quote(xml, safe="")
    deflated = zlib.compressobj(9, zlib.DEFLATED, -15)
    data = deflated.compress(quoted.encode("utf-8")) + deflated.flush()
    b64 = base64.b64encode(data).decode("ascii")
    out = ('<?xml version="1.0" encoding="UTF-8"?>\n'
           '<mxfile host="app.diagrams.net" type="device">'
           '<diagram id="agentcore-mac" name="Page-1">' + b64 + '</diagram></mxfile>\n')
    open(outpath, "w", encoding="utf-8").write(out)
    print("wrote", outpath)

if __name__ == "__main__":
    if sys.argv[1] == "decode":
        decode(sys.argv[2])
    elif sys.argv[1] == "encode":
        encode(sys.argv[2], sys.argv[3])
