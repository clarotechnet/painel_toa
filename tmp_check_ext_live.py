import json, urllib.request, websocket

targets = json.load(urllib.request.urlopen('http://127.0.0.1:9341/json'))
t = next(x for x in targets if x.get('type') == 'page' and 'clarobrasil.etadirect.com' in x.get('url',''))
ws = websocket.create_connection(t['webSocketDebuggerUrl'], suppress_origin=True)
expr = "JSON.stringify({injected:!!window.__TN_INJECTED__,direct:typeof window.__TN_TOA_DIRECT_STATUS__==='function',history:typeof window.__TN_TOA_HISTORY_STATUS__==='function'})"
ws.send(json.dumps({'id':1,'method':'Runtime.evaluate','params':{'expression':expr,'returnByValue':True}}))
while True:
    msg = json.loads(ws.recv())
    if msg.get('id') == 1:
        print(msg.get('result',{}).get('result',{}).get('value',''))
        break
ws.close()
