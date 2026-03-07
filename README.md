# NyangMentions 🐾

O **NyangMentions** é uma ferramenta de monitoramento de chats em tempo real para as plataformas **Twitch** e **YouTube**. Ele permite capturar mensagens que contenham palavras-chave específicas, enviando notificações automáticas para o Discord e permitindo a exportação dos dados para análise.

## 🚀 Funcionalidades

- **Monitoramento Multiplataforma**: Acompanhe chats da Twitch e YouTube simultaneamente.
- **Palavras-chave Personalizáveis**: Configure quais termos você deseja monitorar.
- **Dashboard Web**: Interface intuitiva para visualizar métricas, gerenciar streamers e ver o histórico de menções.
- **Integração com Discord**: Receba alertas instantâneos via Webhook quando uma palavra-chave for detectada.
- **Detecção de Duplicadas**: Sistema inteligente que agrupa mensagens repetidas (ex: spam de emotes).
- **Cálculo de Offset**: Saiba exatamente em que momento da live a mensagem foi enviada.
- **Exportação de Dados**: Gere relatórios em CSV com todo o histórico de menções.

## 🛠️ Tecnologias Utilizadas

- **Backend**: Node.js, Express
- **Real-time**: Socket.io
- **Banco de Dados**: SQLite3
- **APIs de Chat**: `tmi.js` (Twitch), `youtube-chat` (YouTube)
- **Outros**: Axios, Sentiment Analysis, json2csv

## 📋 Pré-requisitos

Antes de começar, você precisará ter instalado em sua máquina:
- [Node.js](https://nodejs.org/) (versão 16 ou superior recomendada)
- [npm](https://www.npmjs.com/) (geralmente vem com o Node.js)

## 🔧 Instalação

1. Clone o repositório ou baixe os arquivos.
2. Abra o terminal na pasta do projeto.
3. Instale as dependências:
   ```bash
   npm install
   ```

## 📂 Configuração

1. O projeto utiliza um banco de Dados SQLite (`monitor.db`) que é criado automaticamente na primeira execução.
2. Através do Dashboard (URL padrão: `http://localhost:3005`), você pode configurar o **Webhook do Discord** na aba de configurações.

## 🏃 Como Usar

Para iniciar o servidor:

```bash
node app.js
```

Após iniciar, acesse o painel de controle pelo navegador:
👉 **[http://localhost:3005](http://localhost:3005)**

No painel, você poderá:
1. Adicionar os canais (Twitch/YouTube) que deseja monitorar.
2. Cadastrar as palavras-chave.
3. Clicar em **"Iniciar Monitoramento"**.

## 📁 Estrutura do Projeto

- `app.js`: Servidor principal e API.
- `monitor.js`: Lógica central de monitoramento de chats.
- `database.js`: Camada de persistência (SQLite).
- `public/`: Interface frontend (HTML/CSS/JS).
- `check_*.js` e `test_*.js`: Scripts de utilidade e testes.

---
Desenvolvido para facilitar o acompanhamento de comunidades e métricas de engajamento. 📈
