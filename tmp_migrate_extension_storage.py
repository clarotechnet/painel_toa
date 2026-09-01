from pathlib import Path
import json, urllib.request, websocket

OLD = Path(r'C:\Users\Usuario\Documents\sistematoa\backend\toa\config\toa_chrome_profile\Default\Local Extension Settings\cfnciaakkhalgljlgcjojcbpecgphakc\000003.log')
NEW_ID = 'bfafngigkfiibfajanneccpagpeoncfb'
WANTED = {'dominiumCloudEnabled','dominiumCloudBaseUrl','dominiumCollectorToken','dominiumCollectorId'}

def varint(buf, pos):
    value = 0; shift = 0
    while pos < len(buf):
        b = buf[pos]; pos += 1
        value |= (b & 0x7f) << shift
        if not b & 0x80: return value, pos
        shift += 7
    raise ValueError('bad varint')

def parse_batch(payload):
    if len(payload) < 12: return []
    pos = 12; out = []
    while pos < len(payload):
        tag = payload[pos]; pos += 1
        klen, pos = varint(payload, pos); key = payload[pos:pos+klen]; pos += klen
        if tag == 1:
            vlen, pos = varint(payload, pos); val = payload[pos:pos+vlen]; pos += vlen
            out.append((key, val))
    return out
