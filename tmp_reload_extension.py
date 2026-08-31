import json
import time
import urllib.request
import websocket

tabs = json.load(urllib.request.urlopen('http://127.0.0.1:9341/json'))
target = next(
    item for item in tabs
    if item.get('type') == 'service_worker'
    and 'cfnciaakkhalgljlgcjojcbpecgphakc' in item.get('url', '')
)
ws = websocket.create_connection(target['webSocketDebuggerUrl'], suppress_origin=True)
ws.send(json.dumps({
    'id': 1,
    'method': 'Runtime.evaluate',
    'params': {
        'expression': "chrome.runtime.reload(); 'reload-requested'",
        'returnByValue': True,
    },
}))
time.sleep(1)
print('reload-requested')
try:
    ws.close()
except Exception:
    pass
