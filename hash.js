const bcrypt = require('bcrypt');

bcrypt.hash('Global@Server', 10).then(hash => {
  console.log(hash);
});
