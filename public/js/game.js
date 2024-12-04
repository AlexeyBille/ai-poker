class PokerClient {
    constructor() {
        this.socket = io();
        this.playerId = null;
        this.gameState = null;
        this.players = new Map();
        this.initializeEventListeners();
    }

    initializeEventListeners() {
        // Логин
        document.getElementById('joinGame').addEventListener('click', () => {
            const playerName = document.getElementById('playerName').value;
            if (playerName.trim()) {
                this.joinGame(playerName);
            }
        });

        // Игровые действия
        document.getElementById('fold').addEventListener('click', () => this.sendAction('fold'));
        document.getElementById('call').addEventListener('click', () => this.sendAction('call'));
        document.getElementById('check').addEventListener('click', () => this.sendAction('call'));
        document.getElementById('raise').addEventListener('click', () => {
            const amount = parseInt(document.getElementById('raiseAmount').value);
            this.sendAction('raise', amount);
        });

        // Слайдер для рейза
        const raiseSlider = document.getElementById('raiseAmount');
        const raiseValue = document.getElementById('raiseValue');
        raiseSlider.addEventListener('input', (e) => {
            raiseValue.textContent = e.target.value;
        });

        // Сокет события
        this.socket.on('gameState', (state) => this.updateGameState(state));
    }

    joinGame(playerName) {
        this.socket.emit('joinGame', { playerName });
        document.getElementById('loginScreen').style.display = 'none';
        document.getElementById('gameContainer').style.display = 'block';
    }

    sendAction(action, amount = 0) {
        this.socket.emit('action', { action, amount });
    }

    updateGameState(state) {
        this.gameState = state;
        this.playerId = this.socket.id;
        
        this.players.clear();
        state.players.forEach(player => {
            this.players.set(player.id, player);
        });
        
        this.updatePlayers(state.players);
        this.updateCommunityCards(state.communityCards);
        this.updateControls(state);
        this.updateGameInfo(state);
        
        if (state.showdownResults) {
            this.showResults(state.showdownResults);
        }
        
        if (state.lastWinner) {
            this.showWinner(state.lastWinner);
        }
    }

    showResults(results) {
        const messages = document.getElementById('gameMessages');
        const winner = results.winner;
        const winnerPlayer = this.players.get(winner.playerId);
        
        if (winnerPlayer) {
            let message = `Победитель: ${winnerPlayer.name}\n`;
            message += `Комбинация: ${winner.handName}\n`;
            messages.textContent = message;
        }
        
        this.updatePlayers(this.gameState.players, true);
    }

    showWinner(winner) {
        const messages = document.getElementById('gameMessages');
        messages.innerHTML = `
            <div class="winner-info">
                Победитель: ${winner.playerName}<br>
                Выигрыш: ${winner.amount}<br>
                Комбинация: ${winner.handName}
            </div>
        `;
    }

    updatePlayers(players, showAllCards = false) {
        const container = document.getElementById('playersContainer');
        container.innerHTML = '';

        // Получаем массив всех игроков
        const playerArray = Array.from(players);
        
        // Находим индекс текущего игрока
        const currentPlayerIndex = playerArray.findIndex(player => player.id === this.playerId);
        
        // Переупорядочиваем массив так, чтобы текущий игрок был всегда внизу (позиция 0)
        let orderedPlayers = [];
        if (currentPlayerIndex !== -1) {
            orderedPlayers = [
                ...playerArray.slice(currentPlayerIndex),
                ...playerArray.slice(0, currentPlayerIndex)
            ];
        } else {
            orderedPlayers = playerArray;
        }

        // Создаем элементы игроков
        orderedPlayers.forEach((player, index) => {
            const playerEl = document.createElement('div');
            playerEl.className = 'player-position';
            
            // Добавляем атрибут позиции
            playerEl.setAttribute('data-position', index);
            
            // Добавляем классы для состояния игрока
            if (player.folded) playerEl.classList.add('folded');
            if (player.id === this.gameState.currentPlayer) playerEl.classList.add('active');

            const showCards = showAllCards || player.id === this.playerId;
            
            playerEl.innerHTML = `
                <div class="player-name">${player.name}</div>
                <div class="player-chips">Фишки: ${player.chips}</div>
                <div class="player-bet">Ставка: ${player.bet}</div>
                <div class="player-cards">
                    ${player.cards.map(card => {
                        if (!showCards && player.id !== this.playerId) {
                            return '<div class="card card-back">🂠</div>';
                        }
                        const isRedSuit = card.suit === '♥' || card.suit === '♦';
                        return `
                            <div class="card ${isRedSuit ? 'red-suit' : ''}">
                                ${card.value}${card.suit}
                            </div>
                        `;
                    }).join('')}
                </div>
            `;

            container.appendChild(playerEl);
        });
    }

    updateCommunityCards(cards) {
        const container = document.getElementById('communityCards');
        container.innerHTML = cards.map(card => {
            const isRedSuit = card.suit === '♥' || card.suit === '♦';
            return `
                <div class="card ${isRedSuit ? 'red-suit' : ''}">
                    ${card.value}${card.suit}
                </div>
            `;
        }).join('');
    }

    updateControls(state) {
        const isCurrentPlayer = state.currentPlayer === this.playerId;
        const player = state.players.find(p => p.id === this.playerId);
        
        document.getElementById('fold').disabled = !isCurrentPlayer;
        document.getElementById('call').disabled = !isCurrentPlayer;
        document.getElementById('check').disabled = !isCurrentPlayer;
        document.getElementById('raise').disabled = !isCurrentPlayer;
        document.getElementById('raiseAmount').disabled = !isCurrentPlayer;

        if (player) {
            const maxRaise = player.chips;
            document.getElementById('raiseAmount').max = maxRaise;
        }
    }

    updateGameInfo(state) {
        document.getElementById('potAmount').textContent = state.pot;
        document.getElementById('currentBet').textContent = state.currentBet;
        
        const messages = document.getElementById('gameMessages');
        messages.textContent = `Стадия: ${this.translateGameStage(state.gameStage)}`;
    }

    translateGameStage(stage) {
        const stages = {
            'waiting': 'Ожидание игроков',
            'preflop': 'Префлоп',
            'flop': 'Флоп',
            'turn': 'Тёрн',
            'river': 'Ривер',
            'showdown': 'Вскрытие карт'
        };
        return stages[stage] || stage;
    }
}

const game = new PokerClient();