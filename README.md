# Casa Pia AC Live

Aplicação web para resultados, ficha de jogo, live e registo de eventos dos escalões de formação.

## Correr no PC

```bash
npm start
```

Abrir:

```text
http://localhost:4173
```

## Acesso

- Delegado: ID `Delegado`, palavra-passe `0000`
- Gestão: ID `Catarina`, palavra-passe `kikomiau`

Nota: este login é local no browser. Para uma publicação pública com dados sensíveis, o próximo passo recomendado é autenticação no backend.

## Publicar no Render

1. Criar uma conta em https://render.com
2. Criar um repositório GitHub com estes ficheiros.
3. Fazer upload/push do projeto para o GitHub.
4. No Render, escolher **New > Blueprint**.
5. Selecionar o repositório.
6. O Render lê o `render.yaml` e cria:
   - web service Node
   - disco persistente em `/var/data`
7. Depois do deploy, abrir o URL gerado pelo Render.

## Dados em produção

O ficheiro inicial é:

```text
data/db.json
```

No primeiro arranque em produção, a app copia esse ficheiro para o disco persistente configurado em `DATA_DIR`.

Depois disso, os registos passam a ficar no disco persistente do servidor.

## Excel

No PC local, a app pode importar/exportar usando a ferramenta de spreadsheet instalada no ambiente Codex.

Em hosting público, se essa ferramenta não existir, a app continua a funcionar com `data/db.json`; a exportação volta como JSON em vez de `.xlsx`.

## Variáveis úteis

Ver `.env.example`.

## Atualizar resultados pelo Excel

Em producao/publico:

1. Entrar com `Catarina` / `kikomiau`.
2. Abrir `Resultados`.
3. Usar `Importar Excel` e escolher o ficheiro `Casa pia.xlsx` atualizado.
4. A app atualiza resultados, jogos e jogadoras, mantendo fichas de jogo, eventos, lives e jogos ocultados.

No PC local, o botao `Recarregar Excel local` tambem tenta ler diretamente o caminho configurado em `CASA_PIA_XLSX`.

Nota importante: um servidor online nao consegue ler automaticamente um ficheiro guardado no OneDrive do teu computador. Para sincronizacao totalmente automatica com OneDrive seria preciso ligar a app a Microsoft Graph/OneDrive com credenciais proprias.

## Sincronizacao automatica por link

Para a app atualizar sozinha a partir de um Excel online, configura estas variaveis no servidor:

```text
CASA_PIA_XLSX_URL=https://.../Casa%20pia.xlsx
CASA_PIA_AUTO_SYNC_MINUTES=5
```

O link tem de ser um download direto do `.xlsx`. No Render, estas variaveis entram em **Environment**.

Com isto ativo:

- a app sincroniza no arranque;
- volta a sincronizar de X em X minutos;
- a Catarina tambem pode carregar em `Sincronizar link online`.

Se o ficheiro estiver privado no OneDrive, o link direto pode deixar de funcionar. Nesse caso, a versao totalmente profissional passa por Microsoft Graph/OneDrive com login e permissao formal da conta.
