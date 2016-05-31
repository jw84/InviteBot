var restify = require('restify')
var builder = require('botbuilder')
var index = require('./dialogs/index')
var prompts = require('./prompts')

// create bot and add dialogs
var launchBot = new builder.BotConnectorBot({
	appId: 'launchbottest', // process.env.appId  // launchbottest
	appSecret: '3979895f0c004678b344d0c5da3450cb' // process.env.appSecret // 3979895f0c004678b344d0c5da3450cb
})

index.addDialogs(launchBot, function (message, newConvo) {
	console.log('got a message')
	if (newConvo) {
		return {
			to: message.from,
			from: message.to
		}
	} else {
		return {
			to: message.to,
			from: message.from,
			conversationId: message.conversationId,
			channelConversationId: message.channelConversationId,
			channelMessageId: message.channelMessageId
		}
	}
})



// setup restify server
var server = restify.createServer()
server.use(restify.queryParser())

// setup redis server
var client = require('redis').createClient(process.env.REDIS_URL)

// hello world
server.get('/', function(req, res) {
	var hello = `
		<html>
			<body>
				<ul>
					<li><form action="/verify" method="get"><input type="text" name="code" /><button type="submit">verify code</button></form></li>
					<li><a href="/invite">Get invite code</a></li>
					<li><a href="/list">List all codes</a></li>
					<li><a href="/users">List all users</a></li>
					<li><a href="/rankings">Get leaderboard</a></li>
					<li><a href="/totals">Get totals</a></li>
					<li>
						<form action="/rank" method="get">
							<input type="text" placeholder="userid" name="userid" />
							<input type="text" placeholder="first_name" name="first_name" />
							<input type="text" placeholder="last_name" name="last_name" />
							<button type="submit">add new user</button>
						</form>
					</li>
					<li><form action="/rankup" method="get"><input type="text" name="user" /><button type="submit">rank up user</button></form></li>
					<li><form action="/getscore" method="get"><input type="text" name="user" /><button type="submit">get score of user</button></form></li>
					<li><form action="/getrank" method="get"><input type="text" name="user" /><button type="submit">get ranking of user</button></form></li>
					<li><form action="/remove" method="get"><input type="text" name="user" /><button type="submit">remove user</button></form></li>
					<li><a href="/x">Clear database</a></li>
				</ul>
			</body>
		</html>
	`
	res.end(hello)
})

// create codes
var randomstring = require('randomstring')

function createCode(req, res, next) {
	// gen uid
	var uid = randomstring.generate({
		length: 5,
		charset: 'numeric',
	})
	// gen code
	var invitecode = randomstring.generate({
		length: 6,
		readable: true,
		capitalization: 'uppercase',
	})
	// save to redis
	client.set(invitecode, uid, function (err, res) {
		console.log(res, invitecode, uid)
	})
	// output from server
	res.json(invitecode)
}

server.get('/invite', createCode)


// verify codes
function verifyCode(req, res, next) {
	// look up invite code
	client.get(req.query.code, function (err, reply) {
		console.log(reply)
		if (reply) {
			res.send(true)
		} else {
			res.send(false)
		}
	})
}

server.get('/verify', verifyCode)


// list codes
function listCodes(req, res, next) {
	client.keys('*', function (err, keys) {
		if (err) return console.log(err)

		// for (var i = 0, len = keys.length; i < len; i++) {
		// 	client.get(keys[i], function (err, reply) {
		// 		res.send(reply)
		// 	})
		// 	res.send(keys[i])
		// }
		res.send(keys)
	})
}

server.get('/list', listCodes)

// clear db
function clearDB(req, res, next) {
	client.flushdb(function (err, reply) {
		if (reply) {
			res.send(true)
		} else {
			res.send(false)
			return console.log(err)
		}
	})
}

server.get('/x', clearDB)



// total rank
var Leaderboard = require('leaderboard')
var rankings = new Leaderboard('rankings', null, client)

server.get('/rankings', function (req, res) {
	rankings.list(function(err, reply) {
		res.send(reply)
	})
})

server.get('/totals', function (req, res) {
	rankings.total(function(err, reply) {
		res.send(reply.toString())
	})
})

server.get('/rank', function (req, res) {
	console.log(req.query.userid, req.query.first_name, req.query.last_name)

	// is user in the system?
	client.sismember("users", req.query.userid, function (err, reply) {
		if (err) console.log(err)

		if (reply==0) {

			// add to users set
			client.sadd("users", req.query.userid, function (err, reply) {

				// create a new invite code
				var invitecode = randomstring.generate({
					length: 6,
					readable: true,
					capitalization: 'uppercase',
				})

				// add to invitecodes set
				client.sadd("invitecodes", invitecode, function (err, reply) {
					
					// set hash of user info
					client.hset("user:%s".replace("%s", req.query.userid), "first_name", req.query.first_name)
					client.hset("user:%s".replace("%s", req.query.userid), "last_name", req.query.last_name)
					client.hset("user:%s".replace("%s", req.query.userid), "invitecode", invitecode)

					// set hash map of user_to_code and code_to_user
					client.hset("user_to_code", req.query.userid, invitecode)
					client.hset("code_to_user", invitecode, req.query.userid)
					
					// add user to rankings
					rankings.add(req.query.userid, 1, function (err, reply) {
						if (err) console.log(err)

						// their current rank
						rankings.rank(req.query.userid, function (err, rank) {
							if (err) console.log(err)

							// what's the total
							rankings.total(function (err, totals) {
								if (err) console.log(err)

								// send back response
								var jsondata = {
									user: req.query.userid,
									invitecode: invitecode,
									rank: rank+1,
									totals: totals
								}
								res.send(jsondata)
							})
						})
					})
				})
			})
		} else {
			// rankUser(invitecode)
			res.send("already a member")
		}
	})
})

// rank up a member
function rankUser(invitecode) {
	if (client.sismember("users", invitecode)) {
		rankings.incr(invitecode, 1, function(err, reply) {
	  	if (err) {
	  		console.log(err)
	  	}
	  	// their currnet rank
	  	rankings.rank(req.query.user, function(err, rank) {
	  		if (err) {
	  			console.log(err)
	  		}
	  		// what's the totals
	  		rankings.total(function(err, totals) {
	  			var data = {
	  				user: req.query.user,
	  				rank: rank + 1,
	  				totals: totals
	  			}  					
	  			return data
	  		})
	  	})
		})
	} else {
		return false
	}
}

// move a member up
server.get('/rankup', function (req, res) {
  rankings.incr(req.query.user, 1, function(err, reply) {
  	if (err) {
  		console.log(err)
  	}
  	// their currnet rank
  	rankings.rank(req.query.user, function(err, rank) {
  		if (err) {
  			console.log(err)
  		}
  		// what's the totals
  		rankings.total(function(err, totals) {
  			var data = {
  				user: req.query.user,
  				rank: rank + 1,
  				totals: totals
  			}  					
  			res.json(data)
  		})
  	})
	})
})


// get score
server.get('/getscore', function (req, res) {
  rankings.score(req.query.user, function(err, score) {
		res.send(score.toString())
	})
})

// get rank
server.get('/getrank', function (req, res) {
   rankings.rank(req.query.user, function(err, rank) {
		res.send((rank + 1).toString())
	})
})

// remove rank
server.get('/remove', function (req, res) {
	rankings.rm(req.query.user, function(err, removed) {
	  res.send(removed)
	})
})


// process microsoft botconnector messages
server.post('/api/messages', launchBot.verifyBotFramework(), launchBot.listen())

// run server
server.listen(process.env.PORT || 5000, function () {
	console.log('%s listening to %s', server.name, server.url)
})
