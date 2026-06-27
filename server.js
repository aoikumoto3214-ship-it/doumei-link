const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');
const fs = require('fs');

app.use(express.json());
app.use(express.static(__dirname));

const USERS_FILE = path.join(__dirname, 'users.json');
const MSGS_FILE = path.join(__dirname, 'messages.json');

if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, JSON.stringify({}), 'utf8');
if (!fs.existsSync(MSGS_FILE)) fs.writeFileSync(MSGS_FILE, JSON.stringify([]), 'utf8');

function loadUsers() { try { return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); } catch(e) { return {}; } }
function saveUsers(users) { fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8'); }
function loadMessages() { try { return JSON.parse(fs.readFileSync(MSGS_FILE, 'utf8')); } catch(e) { return []; } }
function saveMessages(msgs) { fs.writeFileSync(MSGS_FILE, JSON.stringify(msgs, null, 2), 'utf8'); }

// 現在ボイスチャットに参加しているユーザーを管理する配列（サーバーのメモリ上に保持）
let voiceUsers = [];

function ensureFriendData(users, username) {
    if (users[username]) {
        if (!users[username].friends) users[username].friends = [];
        if (!users[username].requests) users[username].requests = [];
    }
}

app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'index.html')); });

app.post('/register', (req, res) => {
    const { username, password, avatar } = req.body;
    if (!username || !password) return res.json({ success: false, message: '入力情報が足りないよ' });
    const users = loadUsers();
    if (users[username]) return res.json({ success: false, message: 'その名前はもう使われているよ' });
    users[username] = { password: password, avatar: avatar || '👾', friends: [], requests: [] };
    saveUsers(users);
    res.json({ success: true });
});

app.post('/login', (req, res) => {
    const { username, password } = req.body;
    const users = loadUsers();
    if (users[username] && users[username].password === password) {
        ensureFriendData(users, username);
        saveUsers(users);
        res.json({ success: true, token: username, avatar: users[username].avatar });
    } else {
        res.json({ success: false, message: '名前かパスワードが違うよ' });
    }
});

app.post('/update-profile', (req, res) => {
    const { oldUsername, newUsername, newAvatar } = req.body;
    const users = loadUsers();
    if (!users[oldUsername]) return res.json({ success: false, message: 'ユーザーが見つからないよ' });

    if (oldUsername !== newUsername) {
        if (users[newUsername]) return res.json({ success: false, message: 'その名前はすでに使われているよ' });
        
        users[newUsername] = { 
            password: users[oldUsername].password, 
            avatar: newAvatar,
            friends: users[oldUsername].friends || [],
            requests: users[oldUsername].requests || []
        };
        delete users[oldUsername];

        Object.keys(users).forEach(u => {
            if (users[u].friends) {
                const fIdx = users[u].friends.indexOf(oldUsername);
                if (fIdx !== -1) users[u].friends[fIdx] = newUsername;
            }
            if (users[u].requests) {
                const rIdx = users[u].requests.indexOf(oldUsername);
                if (rIdx !== -1) users[u].requests[rIdx] = newUsername;
            }
        });

        // ボイチャ中の名前も連動変更
        voiceUsers = voiceUsers.map(u => u.username === oldUsername ? { username: newUsername, avatar: newAvatar } : u);

        const msgs = loadMessages();
        msgs.forEach(msg => {
            if (msg.from === oldUsername) { msg.from = newUsername; msg.avatar = newAvatar; }
            if (msg.to === oldUsername) msg.to = newUsername;
        });
        saveMessages(msgs);
    } else {
        users[oldUsername].avatar = newAvatar;
        voiceUsers = voiceUsers.map(u => u.username === oldUsername ? { username: u.username, avatar: newAvatar } : u);
        const msgs = loadMessages();
        msgs.forEach(msg => { if (msg.from === oldUsername) msg.avatar = newAvatar; });
        saveMessages(msgs);
    }
    saveUsers(users);
    io.emit('voice users update', voiceUsers); // ボイチャ状態を全員に同期
    res.json({ success: true, token: newUsername, avatar: newAvatar });
});

app.get('/my-friends', (req, res) => {
    const username = req.query.username;
    const users = loadUsers();
    if (!users[username]) return res.json({ friends: [], requests: [] });
    ensureFriendData(users, username);
    const friendsData = users[username].friends.map(name => ({ username: name, avatar: users[name]?.avatar || '👾' }));
    const requestsData = users[username].requests.map(name => ({ username: name, avatar: users[name]?.avatar || '👾' }));
    res.json({ friends: friendsData, requests: requestsData });
});

app.post('/friend-request', (req, res) => {
    const { from, to } = req.body;
    const users = loadUsers();
    if (!users[to]) return res.json({ success: false, message: 'その名前のユーザーは存在しないよ' });
    if (from === to) return res.json({ success: false, message: '自分自身には送れないよ' });
    ensureFriendData(users, from);
    ensureFriendData(users, to);
    if (users[from].friends.includes(to)) return res.json({ success: false, message: 'すでにフレンドだよ' });
    if (users[to].requests.includes(from)) return res.json({ success: false, message: 'すでに申請済みだよ' });
    users[to].requests.push(from);
    saveUsers(users);
    res.json({ success: true });
});

app.post('/handle-request', (req, res) => {
    const { myUsername, targetUsername, action } = req.body;
    const users = loadUsers();
    ensureFriendData(users, myUsername);
    ensureFriendData(users, targetUsername);
    users[myUsername].requests = users[myUsername].requests.filter(name => name !== targetUsername);
    if (action === 'accept') {
        if (!users[myUsername].friends.includes(targetUsername)) users[myUsername].friends.push(targetUsername);
        if (users[targetUsername] && !users[targetUsername].friends.includes(myUsername)) {
            users[targetUsername].friends.push(myUsername);
        }
    }
    saveUsers(users);
    res.json({ success: true });
});

app.get('/users', (req, res) => {
    const users = loadUsers();
    const list = Object.keys(users).map(name => ({ username: name, avatar: users[name].avatar }));
    res.json(list);
});

app.get('/messages', (req, res) => { res.json(loadMessages()); });

io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (token) {
        socket.username = token;
        const users = loadUsers();
        socket.avatar = users[token] ? users[token].avatar : '👾';
        return next();
    }
    next(new Error("auth error"));
});

io.on('connection', (socket) => {
    socket.join(socket.username);
    
    // 接続時に、新しく入った人に現在のボイチャ参加者リストを送る
    socket.emit('voice users update', voiceUsers);

    socket.on('chat message', (data) => {
        const msgs = loadMessages();
        const newMsg = { from: socket.username, avatar: socket.avatar, to: data.to, msg: data.msg, time: new Date().toISOString() };
        msgs.push(newMsg);
        saveMessages(msgs);
        if (data.to === 'all') io.emit('chat message', newMsg);
        else io.to(data.to).to(socket.username).emit('chat message', newMsg);
    });

    // ボイチャ参加シグナルを受信
    socket.on('join voice', () => {
        if (!voiceUsers.some(u => u.username === socket.username)) {
            voiceUsers.push({ username: socket.username, avatar: socket.avatar });
            io.emit('voice users update', voiceUsers); // 全員にリストをブロードキャスト
        }
    });

    // ボイチャ退出/切断シグナルを受信
    socket.on('leave voice', () => {
        voiceUsers = voiceUsers.filter(u => u.username !== socket.username);
        io.emit('voice users update', voiceUsers); // 全員にリストをブロードキャスト
    });

    // ログアウトや通信切断時も自動でボイチャリストから削除
    socket.on('disconnect', () => {
        voiceUsers = voiceUsers.filter(u => u.username !== socket.username);
        io.emit('voice users update', voiceUsers);
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => { console.log('同盟 Link 起動完了！'); });
