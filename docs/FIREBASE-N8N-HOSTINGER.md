# Firebase + n8n local + Hostinger

Arquitetura de produção sem VPS:

```text
TOA -> coletor Windows -> webhook n8n local -> Firebase Realtime Database
                                                   |
                                                   v
                                      frontend estático na Hostinger
                                                   |
                                      histórico GPS protegido por login
```

O computador do coletor e o Docker Desktop precisam permanecer ligados. O n8n
faz apenas conexões HTTPS de saída; nenhuma porta do computador precisa ser
aberta no roteador.

## 1. Criar o projeto Firebase

1. Acesse <https://console.firebase.google.com/> e escolha **Adicionar projeto**.
2. Dê um nome ao projeto, por exemplo `dominium-toa`.
3. Analytics é opcional para este painel.
4. No projeto, abra **Criação > Realtime Database > Criar banco de dados**.
5. Escolha uma região. Depois de criar, copie a URL mostrada na tela, semelhante
   a `https://dominium-toa-default-rtdb.firebaseio.com`.
6. Comece em **modo bloqueado**. As regras corretas serão aplicadas na etapa 3.

## 2. Registrar o frontend web

1. Abra **Configurações do projeto > Geral > Seus aplicativos**.
2. Clique no ícone Web (`</>`), dê o nome `painel-dominium-toa` e registre.
3. Copie os valores exibidos em `firebaseConfig`.
4. Abra `public/config.js` e preencha:

```js
window.DOMINIUM_CONFIG = Object.freeze({
  apiBaseUrl: '',
  dataSource: 'firebase',
  firebasePublicRead: true,
  firebasePath: 'dominium/toa/current',
  firebase: Object.freeze({
    apiKey: 'VALOR_DO_FIREBASE',
    authDomain: 'SEU_PROJETO.firebaseapp.com',
    databaseURL: 'https://SEU_PROJETO-default-rtdb.firebaseio.com',
    projectId: 'SEU_PROJETO',
    appId: 'VALOR_DO_FIREBASE',
  }),
});
```

Essa configuração web não é uma conta de serviço e pode existir no frontend.
Com `firebasePublicRead: true`, qualquer visitante pode visualizar o painel.

## 3. Configurar o banco para leitura pública

1. Abra **Realtime Database > Regras**.
2. Copie todo o conteúdo de `firebase/database.rules.json`.
3. Cole no editor e clique em **Publicar**.

As regras permitem leitura pública apenas de `dominium/toa/current`. O caminho
`dominium/toa/history` exige login e um UID liberado em `authorizedUsers`.
Escritas do navegador permanecem bloqueadas; a conta de serviço do n8n continua
responsável pela publicação.

## 4. Habilitar login somente para o histórico GPS

O monitor ao vivo continua público. A aba **Monitoramento Técnico** contém
localização e exige conta autorizada:

1. Abra **Authentication > Sign-in method** e habilite **Google**.
2. Em **Authentication > Configurações > Domínios autorizados**, adicione
   `central.clarotechnet.com.br`.
3. Entre uma vez na nova aba. Se a conta ainda não estiver autorizada, o painel
   exibirá o UID.
4. No Realtime Database, crie `authorizedUsers/SEU_UID` com valor booleano
   `true`.

Não coloque o UID dentro de `public/config.js`.

## 5. Criar a conta de serviço usada pelo n8n

1. Abra **Configurações do projeto > Contas de serviço**.
2. Clique em **Gerar nova chave privada** e confirme. Um JSON será baixado.
3. Abra o n8n em <http://127.0.0.1:5678/>.
4. Entre em **Credentials > Create credential** e procure
   **Google Service Account API**.
5. Use o campo `client_email` do JSON em **Service Account Email**.
6. Use o conteúdo completo de `private_key` em **Private Key**, incluindo as
   linhas `BEGIN PRIVATE KEY` e `END PRIVATE KEY`.
7. Ative **Set up for use in HTTP Request node**.
8. Em **Scope(s)**, informe os dois escopos separados por espaço:

```text
https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/firebase.database
```

9. Salve com o nome `Firebase TOA - Service Account`.
10. Depois de validar tudo, remova o JSON baixado do computador ou guarde-o em
    cofre seguro. Nunca coloque esse arquivo no projeto ou no GitHub.

O n8n guarda a credencial cifrada usando `N8N_ENCRYPTION_KEY`.

## 6. Configurar as variáveis locais

No arquivo `.env.docker`, pode ser mantida a URL real do banco como referência
para os serviços locais:

```dotenv
FIREBASE_DATABASE_URL=https://SEU_PROJETO-default-rtdb.firebaseio.com
```

Confirme também que `DOMINIUM_INGEST_TOKEN` possui um valor longo e aleatório.
O `.env.local` deve possuir exatamente o mesmo token:

```dotenv
DOMINIUM_N8N_WEBHOOK_URL=http://localhost:5678/webhook/dominium-toa-snapshot
DOMINIUM_N8N_LOCATION_WEBHOOK_URL=http://localhost:5678/webhook/dominium-toa-technician-locations
DOMINIUM_INGEST_TOKEN=O_MESMO_TOKEN_DO_ENV_DOCKER
```

Recrie somente o n8n depois das mudanças. O arquivo dedicado mantém
os mesmos volumes atuais, mas sobe apenas PostgreSQL (dados internos do n8n) e
n8n; FastAPI e frontend Docker deixam de ser necessários:

```powershell
docker compose -f compose.firebase.yaml --env-file .env.docker up -d --force-recreate n8n
```

Somente depois de confirmar o Firebase funcionando, os contêineres antigos da
API e do frontend podem ser parados sem apagar dados:

```powershell
docker compose --env-file .env.docker stop cloud-api web
```

## 7. Importar e configurar o workflow

1. No n8n, desative o workflow antigo que grava no PostgreSQL.
2. No menu do n8n, escolha **Import from File**.
3. Importe `docker/n8n/workflows/dominium-toa-firebase.json`.
4. Abra **Receber snapshot TOA** e crie/selecione uma credencial **Header Auth**:
   - Name: `Authorization`
   - Value: `Bearer O_MESMO_DOMINIUM_INGEST_TOKEN`
5. Abra **Gravar snapshot no Firebase** e selecione a credencial
   `Firebase TOA - Service Account`.
6. Confirme que a URL do nó está em modo **Fixed** e contém:

```text
https://SEU_PROJETO-default-rtdb.firebaseio.com/.json
```

7. Salve e publique/ative o workflow.

Depois importe também
`docker/n8n/workflows/dominium-toa-technician-locations.json`:

1. No webhook **Receber pontos GPS**, selecione a mesma credencial Header Auth.
2. No nó **Gravar histórico no Firebase**, selecione
   `Firebase TOA - Service Account`.
3. Confirme a URL do Realtime Database e publique o workflow.

Ao atualizar um workflow GPS já existente, primeiro deixe somente esse workflow
como **unpublished**, importe o arquivo novo, configure as duas credenciais e
publique a versão nova. Não deixe dois workflows publicados com o mesmo caminho
de webhook.

O workflow GPS grava por data em
`dominium/toa/history/technicianLocations/AAAA-MM-DD/technicians`.
Desde o lote v2, cada técnico possui três ramos independentes:

- `gpsReal`: posições realmente observadas, usadas na quilometragem;
- `plannedRoute`: sequência planejada das atividades A, B, C etc.;
- `serviceStops`: OS, contrato, serviço e status das paradas.

O workflow continua aceitando o lote v1 durante a atualização, mas todo lote
novo é gravado nos ramos v2. O painel lê primeiro os ramos v2 e mantém fallback
para `points` e `visits` históricos.

O workflow principal mantém somente o estado operacional atual. Depois da
primeira carga, ele compara as ordens e atividades e envia ao Firebase apenas os
caminhos alterados. Uma reconciliação completa é feita a cada 30 minutos. Já o
workflow GPS acumula os pontos separados por data, pois são eles que permitem
consultar dias anteriores e calcular a quilometragem. Em falhas de internet, o
coletor preserva a fila pendente e tenta novamente.

## 8. Testar o envio

1. Mantenha Docker Desktop aberto e o workflow ativo.
2. Inicie o painel/coletor com `npm start` ou `Abrir_Painel_TOA.cmd`.
3. No n8n, abra **Executions** e confirme uma execução verde.
4. No Firebase, abra **Realtime Database > Dados**.
5. Confirme o caminho `dominium/toa/current/feed` e verifique `loadedAt`.
6. Depois que o TOA fornecer posições, confirme também o caminho
   `dominium/toa/history/technicianLocations/AAAA-MM-DD`.

Na página do TOA, execute no Console do navegador:

```js
window.__TN_TOA_LOCATION_STATUS__()
```

`enviado` deve aumentar. Se a Core API oficial estiver configurada, os campos
`coreApiConfigurada` e `coreApiUltimaSincronizacao` também serão preenchidos.

Se o n8n responder `401`, confira a credencial Header Auth. Se responder `403`,
confira a conta de serviço e os dois escopos. Se a URL estiver incorreta, confira
`FIREBASE_DATABASE_URL` e recrie o contêiner n8n.

## 9. Testar acesso público e histórico protegido

Execute `npm run build` e abra o painel em uma janela anônima. Ele deve carregar
diretamente, sem solicitar conta Google. Ao abrir **Monitoramento Técnico**, deve
pedir login. Uma conta não cadastrada em `authorizedUsers` não pode ler o mapa.

## 10. Publicar na Hostinger

1. Confirme que `public/config.js` contém a configuração Firebase correta.
2. Gere a versão estática:

```powershell
npm run build
```

3. Envie todo o conteúdo de `dist/` para a pasta pública do site na Hostinger,
   normalmente `public_html`.
4. Adicione o domínio usado na Hostinger em **Firebase Authentication >
   Configurações > Domínios autorizados**.
5. Acesse o domínio e confirme que o monitor ao vivo abre sem login.
6. Abra **Monitoramento Técnico**, entre com Google e confirme o histórico.

## Core API oficial do TOA (opcional)

O Bridge 2.6.3 também suporta o endpoint somente leitura
`GET /rest/ofscCore/v1/resources/{resourceId}/positionHistory`. Para usar:

1. Recarregue a extensão descompactada em `chrome://extensions`.
2. Abra **Detalhes > Opções da extensão**.
3. Na seção **API oficial do TOA**, informe a URL
   `https://SUA_INSTANCIA.fs.ocs.oraclecloud.com` e um Bearer token OAuth com
   permissão de leitura de recursos.
4. Ative e salve.

Esse token não vai para GitHub, Hostinger, Firebase, n8n nem para o JavaScript
da página do TOA. Ele permanece no armazenamento local da extensão. Sem token,
o modo passivo continua funcionando sempre que a própria tela do TOA carregar
os pontos do mapa.

## O que não deve ir ao GitHub

- `.env.local`
- `.env.docker`
- JSON da conta de serviço
- `backend/toa/config/toa_credentials.dat`
- perfil dedicado do Chrome
- Bearer token da Core API do TOA

Esses caminhos já estão cobertos pelo `.gitignore`; mantenha no GitHub apenas os
arquivos `.example` e as regras sem segredos.
