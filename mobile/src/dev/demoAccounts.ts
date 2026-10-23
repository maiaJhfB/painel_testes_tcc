/** Contas de apoio: somente keystores cifrados e dados públicos no aplicativo. */
export const demoAccounts = {
  client: {
    did: "0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A",
    displayName: "Vitor Maia",
    role: "client" as const,
    keystore: {"address":"19e7e376e7c213b7e7e7e46cc70a5dd086daff2a","id":"4ddf9181-c837-40cf-a72d-f389af86adba","version":3,"Crypto":{"cipher":"aes-128-ctr","cipherparams":{"iv":"122772f91e404e4e150d7ebecdca9f61"},"ciphertext":"e54d460f7db9e0247e9627ebe6274d63f952c8624723f735cc3858327c26d2ae","kdf":"scrypt","kdfparams":{"salt":"1be09a58a93bf8ca8bbd3739ce65c836ca8aa8b4b04c2676b3e0a86052630545","n":131072,"dklen":32,"p":1,"r":8},"mac":"820116346330ea3a6cd83a4651328f638e05ae8ae27c98a6a1e269ea58c7a72c"}},
  },
  driver: {
    did: "0x1563915e194D8CfBA1943570603F7606A3115508",
    displayName: "Carlos Silva",
    role: "driver" as const,
    keystore: {"address":"1563915e194d8cfba1943570603f7606a3115508","id":"714eb9d0-0e8b-4da8-93f1-410738f510bb","version":3,"Crypto":{"cipher":"aes-128-ctr","cipherparams":{"iv":"c58a2e1892950a290894db283048cfc5"},"ciphertext":"f3f34ef3229e260c54d3abf5425ddbe59bb3b51b7404a6c3267bf09558c256b7","kdf":"scrypt","kdfparams":{"salt":"208a86df94c6f4fe64a1a5802bdda0efcd1cd43a0660084bceeb40c636c428bc","n":131072,"dklen":32,"p":1,"r":8},"mac":"7df7b8e99ec9c4cb1819d7de73cf20de2f688e3ef75353e8e094555b27341cd2"}},
  },
};
