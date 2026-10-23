# Roteiro de demonstração — fluxo idêntico ao produto final

## Objetivo

Gravar somente a experiência normal do usuário da Cooperativa. O aplicativo não exibe modo de teste, atalhos de personas, sugestões especiais ou controles de simulação. A infraestrutura local trabalha nos bastidores como se fosse o motorista remoto, permitindo apresentar o ciclo completo com um único celular.

## Preparação fora da gravação

1. Execute `verificar-demo.bat`. O resultado esperado é **Ambiente demo aprovado para gravação**.
2. Execute `resetar-demo.bat` para restaurar os dados iniciais.
3. Execute `iniciar-demo.bat`.
4. Para gravar com dois celulares, instale o APK da demo (veja a seção abaixo). Para gravar no navegador, abra o projeto pelo QR code do Expo.
5. Copie previamente para o celular o DID do motorista Carlos Silva:

   `0x1563915e194D8CfBA1943570603F7606A3115508`

6. Para gravar o primeiro acesso com uma nova identidade, acesse **Perfil → Remover identidade deste dispositivo → Confirmar remoção**. Guarde antes um backup se a identidade for pessoal. Apenas sair bloqueia a conta, sem removê-la.
7. Capture apenas a tela do celular. O painel web é uma ferramenta do operador e não precisa aparecer no vídeo.

Os dados auxiliares completos estão em `DADOS_DE_APOIO.md`.

## Dois celulares com APK e QR code

1. Conecte o computador e os dois celulares à mesma rede Wi-Fi.
2. Abra o painel em `http://localhost:4747/panel` e localize **📲 Conectar APK por QR code**.
3. Instale o APK da demo no primeiro celular (passageiro). Abra o app, toque em **Ler QR do painel** e escaneie o QR **Passageiro**. Entre com **`Demo@123`**.
4. Instale o APK no segundo celular (motorista). Repita o processo com o QR **Motorista** e a mesma senha.
5. No motorista, toque em **Aguardar Chamadas**.
6. No passageiro, solicite a corrida, verifique o DID de Carlos Silva e chame. O motorista recebe a chamada no segundo celular e aceita.
7. A partir daí, mapa, chat, preço e estados funcionam entre os dois aparelhos, como no fluxo real.

O QR configura o endereço do servidor, a sessão e o papel de cada aparelho, sem precisar editar o APK quando o IP do computador mudar. Em um aparelho sem identidade, a conta de demonstração do papel escolhido é preparada automaticamente. Se o aparelho já tiver outra identidade, o app avisa: remova a identidade atual no Perfil antes de trocar de conta. Se o Windows bloquear a conexão, permita a porta `4747` na rede privada.

## Sessão simultânea no mesmo PC

Este é o modo recomendado para mostrar a interação real entre os dois participantes.

1. Execute `iniciar-demo.bat`.
2. No painel aberto em `http://localhost:4747/panel`, clique em **Iniciar sessão passageiro + motorista**.
3. Duas janelas de até 430 px serão abertas lado a lado. Cada uma possui armazenamento próprio, como se fossem dois celulares.
4. Na janela **Passageiro**, confira Vitor Maia e entre com a senha **`Demo@123`**.
5. Na janela **Motorista**, confira Carlos Silva e entre com a mesma senha **`Demo@123`**. Não é necessário importar chaves; o painel oferece **Copiar senha**.
6. No motorista, toque em **Aguardar Chamadas**.
7. No passageiro, toque em **Solicitar Corrida**, copie o DID do motorista pelo painel e verifique-o. Mostre a estimativa e seu detalhamento e toque em **Chamar por R$ …**.
8. O passageiro continuará aguardando enquanto a janela do motorista exibe **Chamada recebida**.
9. No motorista, mostre o mesmo preço na **Oferta de corrida** e toque em **Aceitar por R$ …**. As duas telas abrirão a corrida com o **Preço combinado** visível.
10. Troque mensagens entre as janelas. O mapa usará o GPS real do computador nas duas janelas; se a permissão for negada, a tela avisa e passa a usar o trajeto de demonstração.
11. Na janela do motorista, avance por **Cheguei ao passageiro**, **Iniciar viagem** e **Concluir viagem**. A janela do passageiro acompanhará cada mudança.

O mapa apresenta as ruas com OpenStreetMap. A rota é calculada pelo OSRM a partir da posição real informada pelo navegador e o trajeto acompanha as curvas. Use o zoom, arraste para explorar e toque no botão de localização para centralizar rota e participantes. O trecho até o embarque é roxo; durante a viagem, o trajeto até o destino fica verde. Distância e ETA acompanham o progresso. Você controla manualmente as mudanças de status.

Permita o acesso à localização quando o navegador solicitar para mostrar o GPS real. Se a permissão for negada, ou se a página estiver em HTTP por IP, o app mostra **Modo demonstração** e usa o trajeto automático em São Paulo — nesse modo, a aproximação leva cerca de 45 segundos e a viagem, 70 segundos. Para gravar o trajeto simulado, basta negar a permissão; para gravar a localização real, permita e mova o aparelho.

Mantenha acesso à internet para visualizar a base do mapa. As rotas fixas ficam em cache local; as rotas por GPS são recalculadas conforme o deslocamento.

Se o navegador bloquear uma das janelas, permita pop-ups para `localhost` ou use os botões **Abrir somente passageiro** e **Abrir somente motorista**. Mesmo quando o navegador preferir abrir guias, a aplicação mantém a largura mobile.

---

## Fluxo principal do passageiro

### 1. Primeiro acesso e identidade autossoberana

Na tela inicial:

1. Mostre os princípios apresentados pelo aplicativo.
2. Toque em **Criar minha conta**.
3. Toque em **Nova identidade**.
4. Defina e confirme uma senha com pelo menos 8 caracteres.
5. Toque em **Criar senha e entrar** e aguarde a proteção da carteira e o login.

O que narrar:

> “No primeiro acesso, o usuário cria sua própria identidade. A chave Ethereum é gerada e cifrada no dispositivo. A senha desbloqueia essa chave localmente e o login é feito por uma assinatura EIP-4361, sem transmitir a senha ou a chave privada ao servidor.”

### 2. Cadastro do perfil cooperado

Na Home:

1. Mostre o DID e o estado **Apenas local**.
2. Toque em **Registrar na Blockchain**; o app abrirá o Perfil.
3. Preencha um nome, mantenha o papel **Cliente** e toque em **Registrar na Polygon**.
4. Confirme o recibo apresentado.
5. Volte para a Home e mostre o estado **Registrado on-chain**.

O que narrar:

> “O perfil associa o endereço autossoberano ao papel do cooperado. Na versão final, esse registro é publicado no IdentityRegistry da Polygon. Leituras posteriores verificam a identidade sem depender de um cadastro privado de plataforma.”

### 3. Solicitação e verificação do motorista

1. Toque em **Solicitar Corrida**.
2. Cole no campo o DID previamente compartilhado por Carlos Silva.
3. Toque em **Verificar na Blockchain**.
4. Mostre o resultado **Identidade verificada on-chain**, com o nome do motorista.
5. Mostre a estimativa com tarifa base, distância e tempo. Toque em **Chamar por R$ …**.

O que narrar:

> “O passageiro usa o DID compartilhado pelo motorista. Antes da conexão, o aplicativo consulta o registro cooperativo, confirma que o endereço pertence a um motorista e só então inicia a negociação P2P.”

Sobre o preço, narre: “Esta simulação usa uma tarifa base, o percurso e a duração estimada. O motorista vê o mesmo valor antes de aceitar e o preço fica vinculado à corrida. Não há cobrança real; os parâmetros são demonstrativos e não representam a comparação de custos de infraestrutura do TCC.”

### 4. Aceite, mapa e localização

Após a conexão, o aplicativo abrirá o mapa. O motorista de apoio executará automaticamente o mesmo comportamento que ocorreria no segundo celular:

1. O status muda para **Motorista a caminho**.
2. O marcador do carro começa a percorrer a rota.
3. O mapa apresenta posição, trajeto e ETA.
4. Depois da aproximação, o status muda para **Motorista chegou**.
5. Em seguida, muda para **Viagem em andamento**.
6. Ao final do trajeto, aparece **Viagem concluída**.

O que narrar:

> “Após o handshake, localização, chat e estados da corrida usam o mesmo envelope de mensagens do DataChannel. O marcador é atualizado em tempo real e o passageiro acompanha a aproximação, o embarque e o trajeto.”

### 5. Chat durante a corrida

Enquanto o motorista estiver a caminho:

1. Toque em **Chat P2P**.
2. Observe a mensagem recebida: **Olá! Corrida aceita. Já estou a caminho.**
3. Envie: **Combinado, estou esperando na portaria.**
4. Aguarde a resposta automática: **Perfeito, aviso assim que eu chegar.**
5. Toque em **Ver Mapa** para retornar ao trajeto.

O que narrar:

> “As mensagens usam a mesma sessão da corrida. No ambiente final, depois da sinalização inicial, o conteúdo trafega diretamente entre os participantes pelo WebRTC DataChannel.”

### 6. Persistência da sessão e segurança

Depois de concluir a corrida:

1. Retorne à Home e abra o Perfil.
2. Mostre **Copiar DID** e **Exportar Chave Privada**. A exportação pede novamente a senha; não exponha a chave no vídeo.
3. Feche e abra novamente o aplicativo.
4. Mostre que a conta é reconhecida, mas permanece bloqueada. Digite a senha e toque em **Entrar** para retornar à Home.

O que narrar:

> “A identidade permanece sob controle do cooperado. O cofre é preservado ao sair, mas somente a senha permite desbloquear a chave no próximo acesso. O backup da chave permite recuperar a identidade se a senha for esquecida; não há redefinição de senha centralizada.”

---

## Fluxo complementar do motorista

Este trecho demonstra a outra visão da aplicação usando o fluxo real de importação.

### Preparação

1. No Perfil, toque em **Sair e bloquear conta**.
2. Na tela de login, toque em **Usar outra identidade**. Antes de substituir uma conta pessoal, guarde seu backup.
3. Escolha **Importar identidade**.
4. Cole a chave privada do motorista disponível em `DADOS_DE_APOIO.md`.
5. Crie e confirme uma senha com pelo menos 8 caracteres e toque em **Importar e entrar**.

Como a chave pertence ao perfil previamente registrado, a Home será carregada como **Carlos Silva — Motorista**.

### Chamada recebida

1. Toque em **Aguardar Chamadas**.
2. Fora da captura do celular, no painel do operador, clique em **Disparar chamada para Carlos**.
3. Mostre a tela **Chamada recebida**.
4. Toque em **Aceitar**.
5. Mostre a conexão, o mapa e o chat.
6. Demonstre os controles do motorista: **Cheguei ao passageiro**, **Iniciar viagem** e **Concluir viagem**.

O que narrar:

> “Na visão do motorista, o aplicativo consulta ofertas destinadas ao seu DID. Ao aceitar, responde à negociação P2P e passa a transmitir localização e estados diretamente ao passageiro.”

---

## Funcionalidades cobertas

| Funcionalidade | Momento da gravação |
|---|---|
| Criação de wallet | Primeiro acesso |
| Importação de wallet | Fluxo complementar do motorista |
| Autenticação SIWE | Continuação após criar ou importar |
| Registro da identidade | Cadastro do perfil |
| Verificação do par | Solicitação da corrida |
| Conexão P2P | Chamar / Aceitar |
| Preço simulado e detalhamento | Solicitação, oferta recebida e preço combinado no mapa |
| GPS em tempo real | Mapa da corrida |
| Chat | Chat P2P |
| Estados da corrida | Aceita, chegou, em viagem e concluída |
| Desbloqueio por senha | Login inicial e ao reabrir o app |
| Gerenciamento de perfil | Nome, papel e DID |
| Exportação e remoção da chave | Perfil |
| Chamada recebida | Fluxo do motorista |

## Entre tomadas

- Execute `resetar-demo.bat` para limpar sessões, mensagens e trajetos.
- Para voltar ao login, use **Perfil → Sair e bloquear conta**. Para gravar o primeiro cadastro novamente, use **Perfil → Remover identidade deste dispositivo → Confirmar remoção**.
- Execute `parar-demo.bat` ao terminar a gravação.
