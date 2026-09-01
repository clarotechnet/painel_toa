import json, urllib.request, websocket
v=json.load(urllib.request.urlopen('http://127.0.0.1:9341/json/version'))
ws=websocket.create_connection(v['webSocketDebuggerUrl'], suppress_origin=True)
ws.send(json.dumps({'id':1,'method':'Extensions.uninstall','params':{'id':'cfnciaakkhalgljlgcjojcbpecgphakc'}}))
print(ws.recv())
ws.send(json.dumps({'id':2,'method':'Extensions.getExtensions','params':{}}))
print(ws.recv())
ws.close()
