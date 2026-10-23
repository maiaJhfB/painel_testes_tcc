# Cooperativa — ambiente isolado de demonstração

Esta pasta contém uma cópia executável da versão mobile, um servidor local de demonstração e dados próprios. Nada aqui altera o código ou o banco do aplicativo em `tcc-2026`.

## Uso rápido no Windows

1. Execute `verificar-demo.bat` antes da gravação.
2. Execute `iniciar-demo.bat`.
3. No painel em <http://localhost:4747/panel>, clique em **Iniciar sessão passageiro + motorista**.
4. O navegador abrirá duas janelas independentes, limitadas à largura mobile. Entre nas duas com a senha **`Demo@123`** para executar a corrida completa no mesmo PC, sem importar chaves.
5. Como alternativa, instale o APK da demo e leia o QR do passageiro em um celular e o do motorista em outro, na mesma rede Wi-Fi. O QR code do Expo continua disponível para abrir a versão web no navegador do celular.
6. Entre takes, execute `resetar-demo.bat`.
7. Ao terminar, execute `parar-demo.bat`.

O roteiro completo está em `ROTEIRO_DEMONSTRACAO.md`.

## APK Android e pareamento por QR code

O painel de testes agora possui a seção **Conectar APK por QR code**, com dois códigos: um para o passageiro (Vitor Maia) e outro para o motorista (Carlos Silva). O QR carrega o endereço do servidor da demo, a sessão e o papel do aparelho. No APK, toque em **Ler QR do painel** na tela inicial ou na Home e escaneie o código correspondente. A imagem é gerada localmente com a biblioteca MIT `qrcodejs`, sem CDN e sem internet.

- O computador e o celular precisam estar na mesma rede Wi-Fi. O QR usa o IP local detectado pelo servidor (por exemplo, `http://192.168.15.6:4747`).
- Se o Windows perguntar, permita o acesso à porta `4747` na rede privada.
- O APK instala como **Cooperativa Demo** (`br.com.cooperativa.plataforma.demo`), separado do aplicativo principal.
- O QR só configura servidor/sessão/papel. A entrada continua sendo feita com a senha **`Demo@123`**; em um aparelho sem identidade, a conta de demonstração do papel escolhido é preparada automaticamente.
- Se o aparelho já tiver outra identidade, o app avisa: o QR não apaga chaves existentes. Remova a identidade atual no Perfil antes de trocar de conta.
- A leitura usa a câmera do celular e não envia fotos. O APK inclui `expo-camera` e permite HTTP local para falar com o servidor da demo.

Para gerar um novo APK a partir desta pasta:

```powershell
cd mobile
.\scripts\build-apk.ps1
```

O script copia o app para uma pasta limpa em `C:\programming\cooperativa-demo-apk-*` (o EAS exige um repositório Git próprio, e esta pasta está dentro do repositório maior do TCC), instala as dependências, cria o commit local de build e envia o perfil `preview`. O perfil gera um APK assinado no EAS. O arquivo `.easignore` mantém `node_modules`, caches e artefatos fora do envio. O projeto EAS é `@vitor_maia/cooperativa-demo`.

## Isolamento

- Aplicativo: nome visível **Cooperativa**, igual ao produto final; scheme `cooperativa-demo` e IDs nativos terminados em `.demo` mantêm o isolamento técnico.
- APK Android: `br.com.cooperativa.plataforma.demo`, com câmera para o QR e HTTP local habilitado somente nesta build de demonstração.
- Metro: porta `8085`.
- Navegador: duas sessões isoladas por janela, com largura máxima de `430 px`.
- API/painel: porta `4747`.
- Banco: `server/demo-data.sqlite`.
- Python: `.venv` local.
- Dependências JS: `mobile/node_modules` local, sem junction para o projeto principal.
- Logs e caches: `.runtime` local.

## Escopo técnico da demo

A carteira Ethereum e a assinatura SIWE são reais. A senha desbloqueia a chave local antes de assinar o login. No celular, o cofre cifrado usa o SecureStore do sistema; no navegador, o cofre e o perfil público ficam no armazenamento local, separados por sessão de demonstração e participante para reproduzir dois dispositivos sem misturar identidades. Blockchain e signaling são substituídos por réplicas locais determinísticas.

Na sessão de duas janelas, passageiro e motorista percorrem as telas reais: desbloqueio por senha, autenticação, solicitação, chamada recebida, aceite, mapa, chat e estados da corrida. A importação continua disponível para recuperação de uma identidade. No modo de um único celular, o motorista de apoio também pode operar automaticamente nos bastidores.

## Acesso por senha

- As novas sessões de duas janelas já possuem os cofres de Vitor Maia (passageiro) e Carlos Silva (motorista), ambos com senha **`Demo@123`**. Essas contas são públicas e exclusivas da demonstração; nunca use suas chaves fora dela.
- Para uma identidade pessoal, escolha **Criar minha conta → Nova identidade**, ou **Usar outra identidade → Importar identidade**, e defina uma senha com pelo menos 8 caracteres. A chave só é informada na importação inicial.
- Identidades guardadas no formato antigo pedem a criação de uma senha uma única vez, preservando a chave e o DID.
- A chave é cifrada no formato Ethereum Keystore V3, com scrypt e AES-128-CTR. A senha não é armazenada nem enviada ao servidor; a chave decifrada permanece somente na memória enquanto a conta está desbloqueada.
- **Sair e bloquear conta** preserva o cofre e exige a senha na próxima entrada. Recarregar o app também volta ao login bloqueado. **Remover identidade deste dispositivo** é uma ação separada, com confirmação.
- Exportar a chave no Perfil exige informar novamente a senha. Guarde um backup seguro: não há recuperação de senha centralizada. Apagar os dados do navegador também apaga o cofre local.
- Uma nova sessão criada no painel representa outros dois dispositivos. Para continuar com uma identidade pessoal já importada, reutilize a mesma janela/URL da sessão.

## Preço simulado na chamada e no aceite

Após verificar o motorista, o passageiro vê a estimativa e seu detalhamento antes de tocar em **Chamar por R$ …**. O motorista recebe a mesma oferta e confirma em **Aceitar por R$ …**. O preço combinado continua visível no mapa e no chat.

Premissas exclusivamente demonstrativas: **R$ 4,50 de base + R$ 2,00 por km + R$ 0,30 por minuto**, com mínimo de **R$ 8,00**. O cálculo usa distância e duração estimadas da rota embarque → destino; não cobra a aproximação do motorista e não usa o tempo acelerado da animação. Exemplo: 5 km e 15 min resultam em R$ 19,00. Não há pagamento ou cobrança real.

O documento de referência `pretcc_final (2).docx` compara custos anuais de infraestrutura e não define tarifa de corrida. Estes valores são premissas da demo, não resultados do TCC. A redução de 87% do cenário arquitetural não é aplicada como desconto ao passageiro. O GPS real altera o mapa e o acompanhamento do deslocamento, mas o preço de demonstração continua sendo calculado sobre o roteiro fixo embarque → destino.

Cada estimativa vale por 10 minutos para realizar a chamada e fica vinculada ao passageiro e ao motorista. Depois de enviada, uma cópia fica salva na sessão: o aceite preserva esse preço, mesmo se a rota mudar ou a estimativa original expirar. O servidor ignora preços enviados pelo navegador e utiliza a estimativa que ele próprio calculou. Se o OSRM falhar, o cartão informa que a rota é aproximada.

Os parâmetros ficam em `server/demo_fares.py`. Reinicie a demo após alterá-los; novas estimativas usam a nova configuração, sem alterar chamadas já enviadas. O banco recebe uma migração aditiva para preservar os dados anteriores.

## Mapa e rota na sessão do navegador

O mapa usa **Leaflet + OpenStreetMap**, com ruas reais, zoom, arraste, botão de centralizar e identificação de motorista, passageiro e destino. O **OSRM** calcula o percurso de carro pelas ruas para as duas fases: aproximação e viagem. Distância e previsão de chegada diminuem conforme o motorista avança.

Não é necessário cadastrar chave de API nem cartão. A base cartográfica precisa de internet. **O GPS é real no navegador**: ao entrar na corrida, o app pede permissão e usa a localização do dispositivo para posicionar o participante, publicar a posição à outra janela e calcular a rota a partir de onde ele está. O destino da demonstração acompanha o embarque real, a poucos quilômetros. A opção evita a chave paga do Google Maps e reutiliza a pilha Leaflet/OSM que já está no projeto; a versão nativa continua usando `expo-location` e `react-native-maps`, e nela a chave do Google Maps precisa estar configurada no `app.json` para o mapa base.

O navegador só libera o GPS em **HTTPS ou localhost**. Se a demo for aberta por um IP da rede em HTTP, ou se a permissão for negada, a tela mostra **Modo demonstração** e usa o trajeto simulado em São Paulo para preservar a gravação. É possível alternar na prática: permita o GPS para a localização real ou negue a permissão para o trajeto automático. Em um celular, prefira o app nativo (Expo/Dev Client) para o GPS real; a página web aberta pela rede em HTTP não recebe permissão de localização do navegador. O deslocamento continua durante o chat. Os controles de chegada, início e conclusão continuam sob comando do motorista.

As rotas fixas são armazenadas por 30 dias em `.runtime/routes`; as rotas calculadas a partir do GPS ficam em memória por poucos minutos. Consultas ao serviço público são limitadas a uma por segundo no servidor. Se o roteamento estiver indisponível, a tela informa que o traçado exibido é aproximado. Não há dados de trânsito em tempo real.

O uso dos servidores públicos destina-se à demonstração acadêmica de baixo volume, com atribuição visível no mapa. Para outro provedor OSRM, configure `DEMO_ROUTER_URL` antes de iniciar.

Referências: [Leaflet](https://leafletjs.com/), [política do OpenStreetMap](https://operations.osmfoundation.org/policies/tiles/), [servidor público OSRM](https://github.com/Project-OSRM/osrm-backend/wiki/Demo-server).

## Comandos úteis

```powershell
.\verificar-demo.ps1
.\iniciar-demo.ps1
.\resetar-demo.ps1
.\parar-demo.ps1
```

Para validar apenas o servidor, sem iniciar o Expo:

```powershell
.\iniciar-demo.ps1 -SemExpo -NaoAbrirPainel
```
