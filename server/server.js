const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

app.use(express.static('public'));

class PokerRoom {
    constructor() {
        this.players = new Map();
        this.deck = [];
        this.communityCards = [];
        this.currentBet = 0;
        this.pot = 0;
        this.currentPlayer = null;
        this.dealer = null;
        this.smallBlind = 10;
        this.bigBlind = 20;
        this.smallBlindPosition = null;
        this.bigBlindPosition = null;
        this.gameStage = 'waiting'; // waiting, preflop, flop, turn, river, showdown
        this.minimumPlayers = 2;
        this.activePlayers = new Set();
        this.lastRaisePlayer = null;
        this.roundBets = new Map();
        this.initialChips = 1000; // Начальное количество фишек
    }

    resetDeck() {
        const suits = ['♠', '♣', '♥', '♦'];
        const values = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
        this.deck = [];
        
        for (let suit of suits) {
            for (let value of values) {
                this.deck.push({ suit, value });
            }
        }
        
        this.shuffle();
    }

    shuffle() {
        for (let i = this.deck.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [this.deck[i], this.deck[j]] = [this.deck[j], this.deck[i]];
        }
    }

    addPlayer(playerId, playerName) {
        this.players.set(playerId, {
            id: playerId,
            name: playerName,
            cards: [],
            chips: this.initialChips,
            bet: 0,
            folded: false,
            position: this.players.size
        });

        if (this.players.size >= this.minimumPlayers && this.gameStage === 'waiting') {
            this.startNewHand();
        }
    }

    removePlayer(playerId) {
        this.players.delete(playerId);
        if (this.players.size < this.minimumPlayers) {
            this.gameStage = 'waiting';
        }
    }

    startNewHand() {
        if (this.players.size < this.minimumPlayers) {
            this.gameStage = 'waiting';
            return;
        }

        this.resetDeck();
        this.communityCards = [];
        this.pot = 0;
        this.currentBet = 0;
        this.activePlayers.clear();
        this.lastRaisePlayer = null;

        // Сброс состояния игроков
        for (let player of this.players.values()) {
            player.cards = [];
            player.bet = 0;
            player.folded = false;
            this.activePlayers.add(player.id);
        }

        // Раздача карт
        for (let player of this.players.values()) {
            player.cards = [this.deck.pop(), this.deck.pop()];
        }

        // Определение позиций
        const playerIds = Array.from(this.players.keys());
        if (!this.dealer || !this.players.has(this.dealer)) {
            this.dealer = playerIds[0];
        } else {
            const currentDealerIndex = playerIds.indexOf(this.dealer);
            this.dealer = playerIds[(currentDealerIndex + 1) % playerIds.length];
        }

        // Установка блайндов
        const dealerIndex = playerIds.indexOf(this.dealer);
        this.smallBlindPosition = playerIds[(dealerIndex + 1) % playerIds.length];
        this.bigBlindPosition = playerIds[(dealerIndex + 2) % playerIds.length];

        // Взымаем блайнды
        const smallBlindPlayer = this.players.get(this.smallBlindPosition);
        const bigBlindPlayer = this.players.get(this.bigBlindPosition);

        smallBlindPlayer.chips -= this.smallBlind;
        smallBlindPlayer.bet = this.smallBlind;
        bigBlindPlayer.chips -= this.bigBlind;
        bigBlindPlayer.bet = this.bigBlind;

        this.currentBet = this.bigBlind;
        this.pot = this.smallBlind + this.bigBlind;

        // Устанавливаем первого игрока (после большого блайнда)
        this.currentPlayer = playerIds[(dealerIndex + 3) % playerIds.length];
        this.gameStage = 'preflop';

        return this.getGameState();
    }

    getNextPlayer(currentPlayerId) {
        return this.getNextActivePlayer(currentPlayerId);
    }

    getNextActivePlayer(currentPlayerId) {
        const playerIds = Array.from(this.players.keys());
        const currentIndex = playerIds.indexOf(currentPlayerId);
        
        // Проходим по кругу, начиная со следующего игрока
        for (let i = 1; i <= playerIds.length; i++) {
            const nextIndex = (currentIndex + i) % playerIds.length;
            const nextPlayerId = playerIds[nextIndex];
            
            // Проверяем, что игрок активен (не в фолде)
            if (this.activePlayers.has(nextPlayerId)) {
                return nextPlayerId;
            }
        }
        
        // Если не нашли следующего активного игрока, возвращаем null
        return null;
    }

    handleAction(playerId, action, amount = 0) {
        if (playerId !== this.currentPlayer) return null;
        
        const player = this.players.get(playerId);
        if (!player) return null;

        let actionTaken = false;

        switch (action) {
            case 'fold':
                player.folded = true;
                this.activePlayers.delete(playerId);
                actionTaken = true;
                break;
                
            case 'call':
                const callAmount = this.currentBet - (player.bet || 0);
                if (callAmount >= 0 && player.chips >= callAmount) {
                    player.chips -= callAmount;
                    player.bet = this.currentBet;
                    this.pot += callAmount;
                    actionTaken = true;
                }
                break;
                
            case 'raise':
                const totalBet = this.currentBet + amount;
                const raiseAmount = totalBet - (player.bet || 0);
                if (raiseAmount > 0 && player.chips >= raiseAmount) {
                    player.chips -= raiseAmount;
                    player.bet = totalBet;
                    this.pot += raiseAmount;
                    this.currentBet = totalBet;
                    this.lastRaisePlayer = playerId;
                    actionTaken = true;
                }
                break;
        }

        if (!actionTaken) {
            return this.getGameState();
        }

        // Если остался только один активный игрок
        if (this.activePlayers.size === 1) {
            const winner = Array.from(this.activePlayers)[0];
            this.handleWinner(winner);
            return this.getGameState();
        }

        // Определяем следующего игрока
        const nextPlayer = this.getNextActivePlayer(playerId);
        if (nextPlayer) {
            this.currentPlayer = nextPlayer;
        }

        // Проверяем, завершился ли круг торговли
        if (this.isRoundComplete()) {
            this.advanceStage();
        }

        return this.getGameState();
    }

    isRoundComplete() {
        // Проверяем, все ли активные игроки сделали одинаковые ставки
        const activePlayers = Array.from(this.activePlayers);
        const firstPlayerBet = this.players.get(activePlayers[0]).bet;
        
        // Проверяем равенство ставок
        const allBetsEqual = activePlayers.every(playerId => {
            const player = this.players.get(playerId);
            return player.bet === firstPlayerBet;
        });

        // Проверяем, что все сделали ход после последнего рейза
        const currentPlayerIndex = activePlayers.indexOf(this.currentPlayer);
        const lastRaisePlayerIndex = this.lastRaisePlayer ? 
            activePlayers.indexOf(this.lastRaisePlayer) : -1;

        // Раунд завершен, если все ставки равны и либо не было рейза,
        // либо все сделали ход после последнего рейза
        return allBetsEqual && (
            this.lastRaisePlayer === null || 
            currentPlayerIndex === lastRaisePlayerIndex
        );
    }

    advanceStage() {
        console.log('Advancing stage from:', this.gameStage); // Для отладки

        // Сбрасываем ставки текущего раунда
        for (let player of this.players.values()) {
            player.bet = 0;
        }
        this.currentBet = 0;
        this.lastRaisePlayer = null;

        switch (this.gameStage) {
            case 'preflop':
                this.gameStage = 'flop';
                // Сжигаем карту и раздаем флоп
                this.deck.pop(); // Сжигаем карту
                this.communityCards = this.deck.splice(0, 3);
                break;
                
            case 'flop':
                this.gameStage = 'turn';
                // Сжигаем карту и раздаем тёрн
                this.deck.pop(); // Сжигаем карту
                this.communityCards.push(this.deck.pop());
                break;
                
            case 'turn':
                this.gameStage = 'river';
                // Сжигаем карту и раздаем ривер
                this.deck.pop(); // Сжигаем карту
                this.communityCards.push(this.deck.pop());
                break;
                
            case 'river':
                this.gameStage = 'showdown';
                this.handleShowdown();
                return;
        }

        console.log('Advanced to stage:', this.gameStage); // Для отладки
        console.log('Community cards:', this.communityCards); // Для отладки

        // Устанавливаем первого активного игрока после дилера
        const nextPlayer = this.getNextActivePlayer(this.dealer);
        if (nextPlayer) {
            this.currentPlayer = nextPlayer;
            this.lastRaisePlayer = null;
        } else {
            console.error('No active players found after dealer');
        }
    }

    handleShowdown() {
        let bestHand = { rank: 0, highCard: 0, playerId: null, handName: null };
        const results = new Map();
        
        for (const playerId of this.activePlayers) {
            const player = this.players.get(playerId);
            const handResult = this.evaluateHand(player.cards, this.communityCards);
            results.set(playerId, handResult);
            
            if (handResult.rank > bestHand.rank || 
               (handResult.rank === bestHand.rank && handResult.highCard > bestHand.highCard)) {
                bestHand = { 
                    rank: handResult.rank, 
                    highCard: handResult.highCard,
                    playerId, 
                    handName: handResult.name 
                };
            }
        }

        this.showdownResults = {
            winner: bestHand,
            allResults: results,
            revealedCards: true
        };

        this.handleWinner(bestHand.playerId, bestHand.handName);
    }

    handleWinner(winnerId, handName) {
        const winner = this.players.get(winnerId);
        winner.chips += this.pot;
        
        this.lastWinner = {
            playerId: winnerId,
            playerName: winner.name,
            amount: this.pot,
            handName: handName
        };
        
        this.pot = 0;

        setTimeout(() => {
            this.resetForNewHand();
            this.startNewHand();
        }, 5000);
    }

    resetForNewHand() {
        this.showdownResults = null;
        this.lastWinner = null;
        for (let player of this.players.values()) {
            player.cards = [];
            player.bet = 0;
            player.folded = false;
        }
        this.communityCards = [];
        this.pot = 0;
        this.currentBet = 0;
    }

    getGameState() {
        return {
            players: Array.from(this.players.values()).map(player => ({
                id: player.id,
                name: player.name,
                chips: player.chips || 0,
                bet: player.bet || 0,
                folded: player.folded,
                cards: player.cards,
                position: player.position
            })),
            communityCards: this.communityCards,
            pot: this.pot,
            currentBet: this.currentBet,
            currentPlayer: this.currentPlayer,
            dealer: this.dealer,
            gameStage: this.gameStage,
            smallBlind: this.smallBlind,
            bigBlind: this.bigBlind,
            smallBlindPosition: this.smallBlindPosition,
            bigBlindPosition: this.bigBlindPosition
        };
    }

    evaluateHand(playerCards, communityCards) {
        const allCards = [...playerCards, ...communityCards];
        
        const cardValues = {
            'A': 14, 'K': 13, 'Q': 12, 'J': 11,
            '10': 10, '9': 9, '8': 8, '7': 7,
            '6': 6, '5': 5, '4': 4, '3': 3, '2': 2
        };

        allCards.sort((a, b) => cardValues[b.value] - cardValues[a.value]);

        const handResult = {
            rank: 0,
            name: '',
            highCard: cardValues[allCards[0].value]
        };

        if (this.isRoyalFlush(allCards)) {
            handResult.rank = 10;
            handResult.name = 'Роял-флеш';
        } else if (this.isStraightFlush(allCards)) {
            handResult.rank = 9;
            handResult.name = 'Стрит-флеш';
        } else if (this.isFourOfKind(allCards)) {
            handResult.rank = 8;
            handResult.name = 'Каре';
        } else if (this.isFullHouse(allCards)) {
            handResult.rank = 7;
            handResult.name = 'Фулл-хаус';
        } else if (this.isFlush(allCards)) {
            handResult.rank = 6;
            handResult.name = 'Флеш';
        } else if (this.isStraight(allCards)) {
            handResult.rank = 5;
            handResult.name = 'Стрит';
        } else if (this.isThreeOfKind(allCards)) {
            handResult.rank = 4;
            handResult.name = 'Тройка';
        } else if (this.isTwoPair(allCards)) {
            handResult.rank = 3;
            handResult.name = 'Две пары';
        } else if (this.isPair(allCards)) {
            handResult.rank = 2;
            handResult.name = 'Пара';
        } else {
            handResult.rank = 1;
            handResult.name = 'Старшая карта';
        }

        return handResult;
    }

    getCardValue(value) {
        const values = {
            '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8,
            '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14
        };
        return values[value];
    }

    isRoyalFlush(cards) {
        if (!this.isFlush(cards)) return false;
        const values = cards.map(card => this.getCardValue(card.value));
        return values.slice(0, 5).join(',') === '14,13,12,11,10';
    }

    isStraightFlush(cards) {
        return this.isFlush(cards) && this.isStraight(cards);
    }

    isFourOfKind(cards) {
        const valueCounts = this.getValueCounts(cards);
        return Object.values(valueCounts).some(count => count >= 4);
    }

    isFullHouse(cards) {
        const valueCounts = this.getValueCounts(cards);
        const counts = Object.values(valueCounts);
        return counts.includes(3) && counts.includes(2);
    }

    isFlush(cards) {
        const suits = cards.map(card => card.suit);
        return new Set(suits).size === 1;
    }

    isStraight(cards) {
        const values = cards.map(card => this.getCardValue(card.value))
            .sort((a, b) => a - b);
        
        for (let i = 0; i < values.length - 4; i++) {
            if (values[i + 4] - values[i] === 4) return true;
        }

        const uniqueValues = [...new Set(values)];
        if (uniqueValues.includes(14)) {
            const lowAceValues = uniqueValues.map(v => v === 14 ? 1 : v).sort((a, b) => a - b);
            for (let i = 0; i < lowAceValues.length - 4; i++) {
                if (lowAceValues[i + 4] - lowAceValues[i] === 4) return true;
            }
        }

        return false;
    }

    isThreeOfKind(cards) {
        const valueCounts = this.getValueCounts(cards);
        return Object.values(valueCounts).some(count => count >= 3);
    }

    isTwoPair(cards) {
        const valueCounts = this.getValueCounts(cards);
        const pairs = Object.values(valueCounts).filter(count => count >= 2);
        return pairs.length >= 2;
    }

    isPair(cards) {
        const valueCounts = this.getValueCounts(cards);
        return Object.values(valueCounts).some(count => count >= 2);
    }

    getValueCounts(cards) {
        const counts = {};
        for (const card of cards) {
            counts[card.value] = (counts[card.value] || 0) + 1;
        }
        return counts;
    }
}

const rooms = new Map();
const defaultRoom = 'main';
rooms.set(defaultRoom, new PokerRoom());

io.on('connection', (socket) => {
    console.log('Игрок подключился:', socket.id);

    socket.on('joinGame', ({ playerName }) => {
        socket.join(defaultRoom);
        const room = rooms.get(defaultRoom);
        room.addPlayer(socket.id, playerName);
        io.to(defaultRoom).emit('gameState', room.getGameState());
    });

    socket.on('action', ({ action, amount }) => {
        const room = rooms.get(defaultRoom);
        const newState = room.handleAction(socket.id, action, amount);
        if (newState) {
            io.to(defaultRoom).emit('gameState', newState);
        }
    });

    socket.on('disconnect', () => {
        console.log('Игрок отключился:', socket.id);
        const room = rooms.get(defaultRoom);
        room.removePlayer(socket.id);
        io.to(defaultRoom).emit('gameState', room.getGameState());
    });
});

const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';

http.listen(PORT, HOST, () => {
    console.log(`Server is running on http://${HOST}:${PORT}`);
});