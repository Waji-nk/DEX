const { expectRevert } = require("@openzeppelin/test-helpers");
const Dai = artifacts.require("mocks/Dai.sol");
const Bat = artifacts.require("mocks/Bat.sol");
const Rep = artifacts.require("mocks/Rep.sol");
const Zrx = artifacts.require("mocks/Zrx.sol");
const Dex = artifacts.require("Dex.sol"); //Import contract abstraction of our DEX

const SIDE = {
  BUY: 0,
  SELL: 1,
};

contract("Dex", (accounts) => {
  let dai, bat, rep, zrx, dex;
  //Producing tickers of the tokens using web3.js
  //const ticker = web3.utils.fromAscii('DAI') => this is how we produce ticker, we'll use map function to do it in elegent way cuz we have 4 tokens

  const [DAI, BAT, REP, ZRX] = ["DAI", "BAT", "REP", "ZRX"].map((ticker) =>
    web3.utils.fromAscii(ticker)
  );

  //extracting two of the addresses
  const [trader1, trader2] = [accounts[1], accounts[2]];

  beforeEach(async () => {
    //These are going to return 4 contract instances deployed
    [dai, bat, rep, zrx] = await Promise.all([
      Dai.new(),
      Bat.new(),
      Rep.new(),
      Zrx.new(),
    ]);
    //deploy dex
    dex = await Dex.new();
    await Promise.all([
      dex.addToken(DAI, dai.address),
      dex.addToken(BAT, bat.address),
      dex.addToken(REP, rep.address),
      dex.addToken(ZRX, zrx.address),
    ]);

    //Defining amount of token we will allocate to the two addresses define above
    const amount = web3.utils.toWei("1000");

    //helper function to allocate ERC20 token
    const seedTokenBalance = async (token, trader) => {
      await token.faucet(trader, amount);
      await token.approve(dex.address, amount, { from: trader });
    };

    //Loop through all the tokens and call seedTokenBalance function on it
    await Promise.all(
      [dai, bat, rep, zrx].map((token) => seedTokenBalance(token, trader1))
    );

    //For trader2
    await Promise.all(
      [dai, bat, rep, zrx].map((token) => seedTokenBalance(token, trader2))
    );
  });

  //Testing Deposit() function of Dex.sol
  it("should deposit tokens", async () => {
    const amount = web3.utils.toWei("100"); //amount of token we want to deposit

    await dex.deposit(
      //calling deposit function on dex

      amount,
      DAI,
      { from: trader1 }
    );

    const balance = await dex.traderBalances(trader1, DAI); //balance of trader using traderBalances mapping from Dex.sol
    assert(balance.toString() === amount);
  });

  it("should NOT deposit tokens if token does not exist", async () => {
    await expectRevert(
      dex.deposit(
        web3.utils.toWei("100"),
        web3.utils.fromAscii("TOKEN-DOES-NOT-EXIST"),
        { from: trader1 }
      ),
      "this token does not exist"
    );
  });

  //Testing withdraw() Function of Dex.sol. We'll deposit and withdraw 100 dai and at the end we'll have our full balance on our account and nothing on the dex
  //Happy path
  it("should withdraw tokens", async () => {
    const amount = web3.utils.toWei("100");

    await dex.deposit(amount, DAI, { from: trader1 }); //Deposit tokens

    await dex.withdraw(amount, DAI, { from: trader1 }); //withdraw tokens

    const [balanceDex, balanceDai] = await Promise.all([
      //getting token balance from dex and token
      dex.traderBalances(trader1, DAI),
      dai.balanceOf(trader1),
    ]);
    assert(balanceDex.isZero()); //balance of dex should be zero
    assert(balanceDai.toString() === web3.utils.toWei("1000"));
  });
  //Test2 withdraw() Unhappy path
  it("should NOT withdraw tokens if token does not exist", async () => {
    await expectRevert(
      dex.withdraw(
        web3.utils.toWei("1000"),
        web3.utils.fromAscii("TOKEN-DOES-NOT-EXIST"),
        { from: trader1 }
      ),
      "this token does not exist"
    );
  });
  //test3 withdraw() unhappypath
  it("should NOT withdraw tokens if balance too low", async () => {
    await dex.deposit(web3.utils.toWei("100"), DAI, { from: trader1 });

    await expectRevert(
      dex.withdraw(web3.utils.toWei("1000"), DAI, { from: trader1 }),
      "balance too low"
    );
  });
  //Tests for createLimitOrder() function.

  //First one is happyPath(1/3)
  it("should create limit order", async () => {
    await dex.deposit(web3.utils.toWei("100"), DAI, { from: trader1 });

    await dex.createLimitOrder(
      //creating limit order
      REP, //bytes32 ticker,
      web3.utils.toWei("10"), //uint amount,
      10, //uint price,
      SIDE.BUY, //Side side
      { from: trader1 }
    );

    //Inspect the orderBook and make sure we find our order
    let buyOrders = await dex.getOrders(REP, SIDE.BUY);
    let sellOrders = await dex.getOrders(REP, SIDE.SELL);
    assert(buyOrders.length === 1);
    assert(buyOrders[0].trader === trader1);
    assert(buyOrders[0].ticker === web3.utils.padRight(REP, 64)); //When we use bytes32 in assert, we PadRight it with web3 fucntion
    assert(buyOrders[0].price === "10");
    assert(buyOrders[0].amount === web3.utils.toWei("10"));
    assert(sellOrders.length === 0); //Should not have any sell order

    //happyPath(2/3)
    // creating the 2nd limit order greater than the first one i.e price = 11
    await dex.deposit(web3.utils.toWei("200"), DAI, { from: trader2 });

    await dex.createLimitOrder(REP, web3.utils.toWei("10"), 11, SIDE.BUY, {
      from: trader2,
    });

    buyOrders = await dex.getOrders(REP, SIDE.BUY);
    sellOrders = await dex.getOrders(REP, SIDE.SELL);
    assert(buyOrders.length === 2);
    assert(buyOrders[0].trader === trader2); // order of trader2
    assert(buyOrders[1].trader === trader1); //order of trader1
    assert(sellOrders.length === 0);

    //creating the 3rd limit order inferior to the first one i.e price = 9
    await dex.deposit(web3.utils.toWei("200"), DAI, { from: trader2 });

    await dex.createLimitOrder(REP, web3.utils.toWei("10"), 9, SIDE.BUY, {
      from: trader2,
    });

    buyOrders = await dex.getOrders(REP, SIDE.BUY);
    sellOrders = await dex.getOrders(REP, SIDE.SELL);
    assert(buyOrders.length === 3);
    assert(buyOrders[0].trader === trader2);
    assert(buyOrders[1].trader === trader1);
    assert(buyOrders[2].trader === trader2);
    assert(sellOrders.length === 0);
  });

  //Unhappy path(3/3)
  //For tokenexist() modifier
  it("Should NOT create limit order if token does not exist", async () => {
    await expectRevert(
      //create a limitorder with unknown token
      dex.createLimitOrder(
        web3.utils.fromAscii("TOKEN-DOES-NOT-EXIST"),
        web3.utils.toWei("1000"),
        10,
        SIDE.BUY,
        { from: trader1 }
      ),
      "this token does not exist"
    );
  });
  //For if token is not Dai
  it("Should NOT create limit order if token is DAI", async () => {
    await expectRevert(
      //create a limitorder with DAI token
      dex.createLimitOrder(DAI, web3.utils.toWei("1000"), 10, SIDE.BUY, {
        from: trader1,
      }),
      "cannot trade DAI"
    );
  });

  //For the require statment of token balance is too low
  it("Should NOT create limit order if token balance is too low", async () => {
    //Deposit 99 REP tokens
    await dex.deposit(web3.utils.toWei("99"), REP, { from: trader1 });
    //Creating limit order of 100, so we will be missing 1 token
    await expectRevert(
      dex.createLimitOrder(
        REP,
        web3.utils.toWei("100"), //amount > deposit
        10,
        SIDE.SELL,
        { from: trader1 }
      ),
      "token balance too low"
    );
  });

  //For the require statment of Dai balance too low
  it("Should NOT create limit order if Dai balance is too low", async () => {
    //Deposit 99 DAI tokens
    await dex.deposit(web3.utils.toWei("99"), DAI, { from: trader1 });
    // Buying 100 REP tokens with 99 DAI deposited
    await expectRevert(
      dex.createLimitOrder(
        REP,
        web3.utils.toWei("10"), //Trying to buy 10 tokens with price of 10 so 100, which is 1 short of DAI
        10,
        SIDE.BUY,
        { from: trader1 }
      ),
      "dai balance too low"
    );
  });

  //Testing CreateMarketOrder()
  //Happypath
  it("Should create market order & match against existing limit order ", async () => {
    //Deposit some DAI tokens
    await dex.deposit(web3.utils.toWei("100"), DAI, { from: trader1 });

    //create limit order
    await dex.createLimitOrder(
      REP,
      web3.utils.toWei("10"), //10 tokens for 10, so 100 DAI, and we have 100 DAI deposited
      10,
      SIDE.BUY,
      { from: trader1 }
    );
    // -- Going to create market order with trader2 for SELL so that it matches the limit order we created above --

    //We'll fund the trader2 with some REP
    await dex.deposit(web3.utils.toWei("100"), REP, { from: trader2 });

    //Create market order for rep
    await dex.createMarketOrder(REP, web3.utils.toWei("5"), SIDE.SELL, {
      //5 tokens, so it'll consume part of balance of trader2, and limit order we created
      from: trader2,
    });

    //Checking if this matches against the limit order and the balances checkout
    const balances = await Promise.all([
      dex.traderBalances(trader1, DAI),
      dex.traderBalances(trader1, REP),
      dex.traderBalances(trader2, DAI),
      dex.traderBalances(trader2, REP),
    ]);
    const orders = await dex.getOrders(REP, SIDE.BUY);

    //Assertions
    assert(orders[0].filled === web3.utils.toWei("5")); //order of trader1 has been filled for 5 tokens which correspond to marketorder of trader2
    assert(balances[0].toString() === web3.utils.toWei("50")); //Check DAI balance of trader1 is 50, 50 is used to buy REP token
    assert(balances[1].toString() === web3.utils.toWei("5")); //Balance of REP of trader1
    assert(balances[2].toString() === web3.utils.toWei("50")); //DAI balance trader2 after selling his REP
    assert(balances[3].toString() === web3.utils.toWei("95")); //Sold 5 of REP
  });

  //UnhappyPath
  it("Should NOT create Market order if token does not exist", async () => {
    await expectRevert(
      //create a limitorder with unknown token
      dex.createMarketOrder(
        web3.utils.fromAscii("TOKEN-DOES-NOT-EXIST"),
        web3.utils.toWei("1000"),
        SIDE.BUY,
        { from: trader1 }
      ),
      "this token does not exist"
    );
  });

  //For if token is not Dai
  it("Should NOT create Market order if token is DAI", async () => {
    await expectRevert(
      //create a limitorder with DAI token
      dex.createMarketOrder(DAI, web3.utils.toWei("1000"), SIDE.BUY, {
        from: trader1,
      }),
      "cannot trade DAI"
    );
  });
  //For the require statment of token balance is too low
  it("Should NOT create Market order if token balance is too low", async () => {
    //Deposit 99 REP tokens
    await dex.deposit(web3.utils.toWei("99"), REP, { from: trader1 });
    //Creating Market order of 100, so we will be missing 1 token
    await expectRevert(
      dex.createMarketOrder(REP, web3.utils.toWei("100"), SIDE.SELL, {
        from: trader1,
      }),
      "token balance too low"
    );
  });

  //For the require statment of Dai balance too low
  it("Should NOT create Market order if Dai balance is too low", async () => {
    //Deposit 100 DAI tokens
    await dex.deposit(web3.utils.toWei("100"), DAI, { from: trader1 });

    await dex.createLimitOrder(REP, web3.utils.toWei("10"), 10, SIDE.SELL, {
      from: trader1,
    }),
      //Buying these tokens from another trader but without any balance in DAI
      await expectRevert(
        dex.createMarketOrder(REP, web3.utils.toWei("100"), SIDE.BUY, {
          from: trader2,
        }),
        "dai balance too low"
      );
  });
});
