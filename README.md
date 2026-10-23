# 🎬 StreamFlix Cinema - Cloud Backend (Render.com)

Backend em nuvem de alta performance para o aplicativo **StreamFlix Cinema** (Samsung Smart TV Tizen e Celular / Web).

Este servidor permite que você e qualquer usuário acessem o login pelo celular, gerenciem perfis e utilizem o aplicativo em **qualquer lugar do mundo**, sem depender de localhost ou PC ligado em casa.

---

## 🚀 Como Hospedar no Render (Gratuito - 1 Clique)

1. Acesse o seu painel do [Render Dashboard](https://dashboard.render.com).
2. Clique no botão **New +** e selecione **Web Service**.
3. Conecte sua conta do GitHub e selecione este repositório: `Drapent/streamflix-server`.
4. O Render vai preencher automaticamente as configurações:
   - **Name**: `streamflix-server`
   - **Runtime**: `Python 3`
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `python server.py`
   - **Plan**: `Free`
5. Clique em **Create Web Service**.
6. Em cerca de 1 a 2 minutos seu servidor estará online em:
   `https://streamflix-server.onrender.com`

---

## 📱 Acesso pelo Celular

- **URL de Login e Gerenciamento de Perfis**:
  `https://streamflix-server.onrender.com/` (ou `/login_celular.html`)

Basta abrir este link no navegador de qualquer celular (Wi-Fi, 4G, 5G) para:
- Conectar a Smart TV digitando o código de 6 dígitos que aparece na tela.
- Criar novos perfis com escolha de avatares coloridos.
- Alternar e editar perfis existentes (Carlos e Angelo).
- Recuperar senha ("Esqueceu a senha?").

---

## 🔑 Credenciais Padrão Pré-Configuradas

- **E-mail:** `angeloregis@gmail.com`
- **Senha:** `Carlos25Marina15`
- **Perfis Sincronizados:** `Carlos` (Ouro VIP) e `Angelo` (Azul Neon)

---

## 📡 Endpoints da API

- `GET /health` -> Verificação de status do servidor
- `GET /api/auth/pair/code` -> Gera código de 6 dígitos para a Smart TV
- `GET /api/auth/pair/check?code=...` -> TV verifica se celular autorizou
- `POST /api/auth/pair/confirm` -> Celular autoriza pareamento
- `POST /api/auth/login` -> Login de conta
- `POST /api/auth/register` -> Criação de nova conta
- `POST /api/auth/forgot-password` -> Solicitação de recuperação de senha
- `POST /api/auth/reset-password` -> Redefinição de senha
- `GET /api/sync/profiles` -> Listagem de perfis da conta
- `POST /api/sync/profiles` -> Criação, edição e exclusão de perfis
