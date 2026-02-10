import { Wallet } from 'ethers';
const w = Wallet.createRandom();
console.log(w.mnemonic?.phrase);