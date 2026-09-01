import json, urllib.request, websocket

version = json.load(urllib.request.urlopen('http://127.0.0.1:9341/json/version'))
ws = websocket.create_connection(version['webSocketDebuggerUrl'], suppress_origin=True)

def call(i, method, params=None):
    ws.send(json.dumps({'id': i, 'method': method, 'params': params or {}}))
    while True:
        msg = json.loads(ws.recv())
        if msg.get('id') == i:
            return msg

exts = call(1, 'Extensions.getExtensions').get('result', {}).get('extensions', [])
print('EXTENSIONS', json.dumps(exts, ensure_ascii=False))
for ext_id in ['bfafngigkfiibfajanneccpagpeoncfb','cfnciaakkhalgljlgcjojcbpecgphakc']:
    r = call(2 if ext_id.startswith('b') else 3, 'Extensions.getStorageItems', {'id': ext_id, 'storageArea': 'local'})
    data = r.get('result', {}).get('data', {})
    print(ext_id, json.dumps({
        'cloudEnabled': data.get('dominiumCloudEnabled') is True,
        'cloudBaseConfigured': bool(str(data.get('dominiumCloudBaseUrl') or '').strip()),
        'collectorTokenConfigured': bool(str(data.get('dominiumCollectorToken') or '').strip()),
        'collectorIdConfigured': bool(str(data.get('dominiumCollectorId') or '').strip()),
    }))
ws.close()
