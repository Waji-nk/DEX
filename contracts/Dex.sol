// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import '@openzeppelin/contracts/token/ERC20/IERC20.sol';

contract Dex {

       
    enum Side {
        BUY,
        SELL
    }
    
    struct Token {
        bytes32 ticker;
        address tokenAddress;
    }
    
    struct Order {
        uint id;
        address trader;
        Side side;
        bytes32 ticker;
        uint amount;
        uint filled;
        uint price;
        uint date;
    }
    
    mapping(bytes32 => Token) public tokens;
    bytes32[] public tokenList;
    mapping(address => mapping(bytes32 => uint)) public traderBalances;
    mapping(bytes32 => mapping(uint => Order[])) public orderBook;
    address public admin;
    uint public nextOrderId;
    uint public nextTradeId;
    bytes32 constant DAI = bytes32('DAI');
    
    //NewTrade: ticker => Refeferencing which token we are trading (indexed to filter it on the frontend)
            //  orderId => reference orderId 
            //trader1, trader2 => addresses of traders
            // amount of trade
    event NewTrade(
        uint tradeId,
        uint orderId,
        bytes32 indexed ticker,
        address indexed trader1, 
        address indexed trader2, 
        uint amount,
        uint price,
        uint date
    );
    
    constructor()  {
        admin = msg.sender; //We defined the admin that will instantiate the contract
    }

    function getOrders(
      bytes32 ticker, 
      Side side) 
      external 
      view
      returns(Order[] memory) {
      return orderBook[ticker][uint(side)];
    }

    function getTokens() 
      external 
      view 
      returns(Token[] memory) {
      Token[] memory _tokens = new Token[](tokenList.length);
      for (uint i = 0; i < tokenList.length; i++) {
        _tokens[i] = Token(
          tokens[tokenList[i]].ticker,
          tokens[tokenList[i]].tokenAddress
        );
      }
      return _tokens;
    }
    
    function addToken(
        bytes32 ticker,
        address tokenAddress)
        onlyAdmin()
        external {
        tokens[ticker] = Token(ticker, tokenAddress);
        tokenList.push(ticker);
    }
    
    function deposit(
        uint amount,
        bytes32 ticker)
        tokenExist(ticker)
        external {
        IERC20(tokens[ticker].tokenAddress).transferFrom(
            msg.sender,
            address(this),
            amount
        );
        traderBalances[msg.sender][ticker] += amount;
    }
    
    function withdraw(
        uint amount,
        bytes32 ticker)
        tokenExist(ticker)
        external {
        require(
            traderBalances[msg.sender][ticker] >= amount,
            'balance too low'
        ); 
        traderBalances[msg.sender][ticker] -= amount;
        IERC20(tokens[ticker].tokenAddress).transfer(msg.sender, amount);
    }
    
    function createLimitOrder(
        bytes32 ticker,
        uint amount,
        uint price,
        Side side)
        tokenExist(ticker)
        tokenIsNotDai(ticker)
        external {
        if(side == Side.SELL) {
            require(
                traderBalances[msg.sender][ticker] >= amount, 
                'token balance too low'
            );
        } else {
            require(
                traderBalances[msg.sender][DAI] >= amount * price,
                'dai balance too low'
            );
        }
        //Pointer to all the orders
        Order[] storage orders = orderBook[ticker][uint(side)];
        //push the order at the end of the order array
        orders.push(Order(
            nextOrderId, //uint id
            msg.sender,    
            side,        //Side side
            ticker,     //bytes32 ticker 
            amount,     // uint amount;
            0,          // uint filled;
            price,      // uint price;
            block.timestamp  // uint date;
        ));
        
        //To get the orders in sort, we'll use bubble sort algorithm here
        uint i = orders.length > 0 ? orders.length - 1 : 0;
        while(i > 0) {
            if(side == Side.BUY && orders[i - 1].price > orders[i].price) {
                break;   
            }
            if(side == Side.SELL && orders[i - 1].price < orders[i].price) {
                break;   
            }
             //If none of the above condition met, we'll swap the orders
            Order memory order = orders[i - 1]; //Save copy of the previous element in memory
            orders[i - 1] = orders[i]; //Current element will be swap with the previous one
            orders[i] = order;  //previous will be copied in the next one
            i--;
            //We'll keep doing this until  one of the if condition is met or we;ll reach at the begining of the array
        }
        nextOrderId++;
    }
    
    // MarketOrder function
    function createMarketOrder(
        bytes32 ticker,
        uint amount,
        Side side)
        tokenExist(ticker)
        tokenIsNotDai(ticker)
        external {
        if(side == Side.SELL) {
            require(
                traderBalances[msg.sender][ticker] >= amount, 
                'token balance too low'
            );
        }
        Order[] storage orders = orderBook[ticker][uint(side == Side.BUY ? Side.SELL : Side.BUY)];
        uint i; // variable to iterate through the orderBook
        uint remaining = amount; //remaining portion that is not filled, initially would be equal to amount cus we didn't start the matching process yet
        
       while(i < orders.length && remaining > 0){
           uint available = orders[i].amount - orders[i].filled;  //What is the available liquidity for the each order of the orderbook
           uint matched = (remaining > available) ? available : remaining;
           remaining -= matched; //decrement the remaining variable by what is being matched
           orders[i].filled +=matched; //Increment the order in orderBook, so can't be available for the next order that tried to matched against it
           emit NewTrade(              //Emmit the newtrade     
                nextTradeId,   // uint tradeID,
                orders[i].id,   // uint orderId,  
                ticker,        // bytes32 indexed ticker, 
                orders[i].trader, msg.sender,  // trader1=> who created the order in orderbook trader2=> created marketorder 
                matched,  // uint amount, //amount of the trade
                orders[i].price, // uint price,
                block.timestamp  // uint date
            ); 

            // Next we need to update token balance for two traders that were involved in this trade
            if(side == Side.SELL){
               traderBalances[msg.sender][ticker] -= matched;
               traderBalances[msg.sender][DAI] += matched * orders[i].price;
               traderBalances[orders[i].trader][ticker] += matched;
               traderBalances[orders[i].trader][DAI] -= matched * orders[i].price;
           }
            if(side == Side.BUY){
               require(traderBalances[msg.sender][DAI] >= matched * orders[i].price,
                "Dai balance too low");
               traderBalances[msg.sender][ticker] += matched;
               traderBalances[msg.sender][DAI] -= matched * orders[i].price;
               traderBalances[orders[i].trader][ticker] -= matched;
               traderBalances[orders[i].trader][DAI] += matched * orders[i].price;
           }
           nextTradeId++;
           i++; 
        }
        //Removing orders that are filled to save us cost
        i = 0;
        while(i < orders.length && orders[i].filled == orders[i].amount) {
            //[A,B,C,D,E,F] => When A is filled gonna popout the A and shift others like [B,C,D,E,F]
            for(uint j = i; j < orders.length - 1; j++ ) {
                orders[j] = orders[j + 1];
            }
            orders.pop();
            i++;
        }
    }

   //Make sure the token is not DAI
    modifier tokenIsNotDai(bytes32 ticker) {
       require(ticker != DAI, 'cannot trade DAI');
       _;
    }     
    
    //Make sure that the token exist
    modifier tokenExist(bytes32 ticker) {
        require(
            tokens[ticker].tokenAddress != address(0),
            'this token does not exist'
        );
        _;
    }
    
    modifier onlyAdmin() {
        require(msg.sender == admin, 'only admin');
        _;
    }
}