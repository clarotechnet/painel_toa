import json, urllib.request, websocket, time

version = json.load(urllib.request.urlopen('http://127.0.0.1:9341/json/version'))
ws = websocket.create_connection(version['webSocketDebuggerUrl'], suppress_origin=True)

def call(i, method, params=None):
    ws.send(json.dumps({'id': i, 'method': method, 'params': params or {}}))
    while True:
        msg = json.loads(ws.recv())
        if msg.get('id') == i:
            return msg

before = call(1, 'Extensions.getExtensions')
print('BEFORE', json.dumps(before.get('result',{}), ensure_ascii=False))
loaded = call(2, 'Extensions.loadUnpacked', {'path': r'C:\Users\Usuario\Documents\sistematoa\toa-bridge'})
print('LOAD', json.dumps(loaded, ensure_ascii=False))
time.sleep(1)
after = call(3, 'Extensions.getExtensions')
print('AFTER', json.dumps(after.get('result',{}), ensure_ascii=False))
ws.close()
