# Demo atualizada — 24/10/2026

Versão baseada em [maiaJhfB/painel_testes_tcc](https://github.com/maiaJhfB/painel_testes_tcc), revisão `c3c8e02b493253725098138cce18b21a58c181ec`, com ajustes locais de execução, portas e mapa.

## Iniciar

Nesta pasta, abra **iniciar-demo.bat**. O inicializador prepara as dependências ausentes, compila o aplicativo web e abre **http://localhost:4748/panel**. Não feche a janela durante a preparação. Os serviços continuam em segundo plano após a mensagem de sucesso.

No painel, clique em **Iniciar sessão passageiro + motorista**. Entre nas duas janelas com **Demo@123**. O aplicativo web abre na porta **8086**. O painel/API usa **4748**. Essas portas são próprias desta versão; a demo anterior na porta 4747 foi preservada.

Ao abrir novamente, o inicializador reaproveita a mesma sessão saudável, sem recompilar ou alterar dados. Se os processos anteriores já terminaram ou seus PIDs foram reutilizados, os registros comprovadamente antigos são arquivados em .runtime/previous-processes e uma nova sessão é iniciada. Nenhum processo é encerrado nessa recuperação. Se houver porta ocupada, sessão parcial ou identidade que o Windows não permita comprovar, a partida é bloqueada e os processos são preservados. Use parar-demo para encerrar uma sessão própria antes de trocar as portas. Para usar outras portas:

```powershell
.\iniciar-demo.bat -PortaApi 4749 -PortaWeb 8087
```

O parâmetro `-SemExpo` inicia somente a API; as duas janelas requerem o modo completo. `-NaoAbrirPainel` evita abrir o navegador automaticamente.

## Encerrar, verificar e limpar dados de demonstração

- Encerrar esta versão: `parar-demo.bat`. Apenas os processos registrados e verificados desta cópia são encerrados.
- Verificações locais: `verificar-demo.bat`. Incluem testes de servidor/app, tipos, rotas e compilação web.
- Recomeçar uma gravação: `resetar-demo.bat`. Apaga somente os dados demonstrativos da instância nova comprovada. Com porta alternativa, passe `-PortaApi 4749`.

O banco desta cópia fica em `atualizado/server/demo-data.sqlite`, e os logs em `atualizado/.runtime/`. As identidades pessoais, os bancos e as dependências da versão anterior não foram migrados nem substituídos. Novas contas são apenas as contas públicas da demonstração.

## Mapas e celular

A atualização integra a tela de mapa compartilhada, localização nativa com recuperação de erros e mapa Leaflet em WebView no Android. O mapa usa arquivos Leaflet locais; ruas/rotas externas precisam de internet e podem mostrar modo aproximado. GPS negado/indisponível pode usar o percurso de demonstração, claramente indicado na interface. Testes automatizados não comprovam GPS físico ou deslocamento real.

O APK antigo não foi atualizado. Para usar o novo componente nativo WebView é necessário um novo APK compatível. Nenhum APK foi gerado, instalado ou publicado nesta operação. O QR configura servidor/sessão/papel e não apaga identidades existentes. No navegador, GPS exige localhost ou HTTPS; HTTP pelo IP da rede não libera GPS.

## Estrutura e preservação

O servidor anterior estava ativo durante a atualização. Por isso a aplicação atualizada está integralmente em `atualizado/`, com dependências próprias. Os atalhos antigos continuam correspondendo à versão antiga. Nenhum serviço antigo foi encerrado, recarregado ou alterado.

O arquivo `mobile/app.json` da versão antiga foi preservado. A cópia nova conserva configurações locais compatíveis, com versão 0.1.1/versionCode 2. Seu endereço padrão é localhost:4748; o inicializador usa `EXPO_PUBLIC_DEV_SERVER_URL` para configurar o bundle sem reescrever esse arquivo.

## Docker opcional

Use `atualizado/` como contexto de build. A imagem foi corrigida para incluir os arquivos Leaflet no runtime, mas não foi construída ou publicada nesta atualização. O padrão interno Docker continua sendo API4747/web8085. Para usar portas diferentes, API, painel e endereço compilado no bundle precisam concordar; para a execução pronta e verificada neste PC, prefira o atalho Windows acima.

Registro de origem, comparação, parecer e evidências: `.atualizacao-2026-10-24/`. Sem commit, push, deploy ou interação com aparelho.
