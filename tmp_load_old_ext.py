import json, urllib.request, websocket

version = json.load(urllib.request.urlopen('http://127.0.0.1:9341/json/version'))
ws = websocket.create_connection(version['webSocketDebuggerUrl'], suppress_origin=True)

def call(i, method, params=None):
    ws.send(json.dumps({'id': i, 'method': method, 'params': params or {}}))
    while True:
        msg = json.loads(ws.recv())
        if msg.get('id') == i:
            return msg

r = call(1, 'Extensions.loadUnpacked', {'path': r'C:\Users\Usuario\Documents\sistematoa\toa-bridge'})
print('loaded_id', r.get('result',{}).get('id',''))
exts = call(2, 'Extensions.getExtensions').get('result',{}).get('extensions',[])
print('extensions', [(e.get('id'), e.get('enabled'), e.get('path')) for e in exts])
for e in exts:
    if e.get('id') == 'cfnciaakkhalgljlgcjojcbpecgphakc':
        data = call(3, 'Extensions.getStorageItems', {'id': e['id'], 'storageArea': 'local'}).get('result',{}).get('data',{})
        print('cloud_enabled', data.get('dominiumCloudEnabled') is True)
        print('cloud_base_configured', bool(str(data.get('dominiumCloudBaseUrl') or '').strip()))
        print('collector_token_configured', bool(str(data.get('dominiumCollectorToken') or '').strip()))
        print('collector_id_configured', bool(str(data.get('dominiumCollectorId') or '').strip()))
ws.close()
