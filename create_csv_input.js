var fs = require('fs');

fs.readFile('scripts/users/0.txt', 'utf8', function(err, data) {
	if (err) {
		console.error(err);
		process.exit(1);
	}

	var users = {};
	var userMemberships = {};
	var userPseudoMemberships = {};

	data = data.split('\n');
	
	console.log('Building username/password for '+data.length+' users.')
	
	// parse all users
	data.forEach(function(item) {
		item = JSON.parse(item);
		users[item.userid] = item.password;
		
		// seed the membership arrays
		userMemberships[item.userid] = {}; // unique
		userPseudoMemberships[item.userid] = [];
	});
	
	console.log('Reading worlds to build membership / role request info.');
	
	// find my group memberships request data
	var data = fs.readFileSync('scripts/worlds/0.txt', 'utf8');
  data = data.split('\n');
  
  console.log('Read '+data.length+' worlds. Building membership / role information for users.');
  
  var worldNum = 0;
  data.forEach(function(world) {
    world = JSON.parse(world);
    for (var roleId in world['roles']) {
      world['roles'][roleId]['users'].forEach(function(userId) {
        // if the user is a lecturer in world called "CourseA", then their pseudo group is "CourseA-lecturer"
        userMemberships[userId][world.id] = true;
        userPseudoMemberships[userId].push(world.id+'-'+roleId);
      });
    }
  });
  
  console.log('Writing user, password, membership info to users.csv');
  
  // write users to file
  var fd = fs.openSync('users.csv', 'w');
  var buffer = new Buffer("userid,password,my_memberships_batch_requests,my_memberships_members_batch_requests\n");
  fs.writeSync(fd, buffer, 0, buffer.length, null);
  for (var userId in users) {
    var pw = users[userId];
    var memberships = userMemberships[userId]; // e.g., [groupA, groupB, groupC, ...]
    var membershipRequests = generateMyMembershipsInfoRequests(memberships); // e.g., [{url: '/system/userManager/group/groupA.json, method: 'GET' ...}, ...]
    var encodedMembershipRequests = encodeURIComponent(JSON.stringify(membershipRequests));

    var pseudoMemberships = userPseudoMemberships[userId];
    var membershipMembersRequests = generateMyMembershipsMembersInfoRequests(pseudoMemberships);
    var encodedMembershipMembersRequests = encodeURIComponent(JSON.stringify(membershipMembersRequests));
    
    buffer = new Buffer(userId+','+users[userId]+','+encodedMembershipRequests+','+encodedMembershipMembersRequests+'\n');
    fs.writeSync(fd, buffer, 0, buffer.length, null);				
  }
  fs.closeSync(fd);
  
  console.log('Complete users. On to contacts.');
  
	// parse all contacts
	fs.readFile('scripts/contacts/0.txt', 'utf8', function(err, data) {
   	data = data.split('\n');
   	console.log('Read '+data.length+' contacts.');
	  console.log('Creating all possible combinations of contact invitations');
	  
		var canInvite = createPotentialInvites(users);
		var canAccept = {}
		var contactsNum = 0;

    console.log('Determine possible combinations for contact invitation and acceptance.');
		
		// build connection information
		data.forEach(function(item) {
		  contactsNum++;
		
			item = JSON.parse(item);
			
			// Record the fact that the source user CANNOT invite the dest user
			deletePotentialInvite(canInvite, item.inviter, item.invitee);
			deletePotentialInvite(canInvite, item.invitee, item.inviter);
			
			// Record the fact that the source may accept the dest, if true
			if (!item['willAccept']) {
				canAccept[item.inviter] = item.invitee;
			}
			
			if (contactsNum % 1000 == 0) {
			  console.log('Analyzed '+contactsNum+' contacts.');
			}
		});

		console.log('Analyzed '+contactsNum+' contacts.');
		console.log('Writing contact invites to can_invite.csv');
		
		var fd = fs.openSync('can_invite.csv', 'w');
    var buffer = new Buffer('inviter,inviter_password,invitee,invitee_password\n');
    fs.writeSync(fd, buffer, 0, buffer.length, null);
    for (var inviterId in canInvite) {
      var i;
      for (i = 0; i < canInvite[inviterId].length; i++) {
        var inviteeId = canInvite[inviterId][i];
        if (inviteeId) {
          var buffer = new Buffer(inviterId+','+users[inviterId]+','+inviteeId+','+users[inviteeId]+'\n');
          fs.writeSync(fd, buffer, 0, buffer.length, null);
        }
      }
    }    
    fs.closeSync(fd);
		
		console.log('Writing contact acceptances to can_accept.csv');

    // write invitation acceptances
    fd = fs.openSync('can_accept.csv', 'w');    
    var buffer = new Buffer('inviter,inviter_password,invitee,invitee_password\n');
    fs.writeSync(fd, buffer, 0, buffer.length, null);
    for (var inviter in canAccept) {
      var invitee = canAccept[inviter];
      buffer = new Buffer(inviter+','+users[inviter]+','+invitee+','+users[invitee]+'\n');
      fs.writeSync(fd, buffer, 0, buffer.length, null);
    }
    fs.closeSync(fd);
    
    console.log('Process complete.');
    
	  process.exit(0);
	});
	
	function generateMyMembershipsInfoRequests(memberships) {
	  // memberships is an object of {<groupId>: true}
		var requests = [];
		for (var membership in memberships) {
			requests.push({
				"url": "/system/userManager/group/"+membership+".json",
				"method": "GET",
				"_charset_": "utf-8"});
		}
		return requests;
	}
	
	function generateMyMembershipsMembersInfoRequests(pseudoMemberships) {
		// pseudo memberships are an array of group id's
		var requests = [];
		pseudoMemberships.forEach(function(pseudoMembership) {
			requests.push({
				"url": "/system/userManager/group/"+pseudoMembership+".members.json",
				"method": "GET",
				"_charset_": "utf-8",
				"parameters": {
						"_charset_": "utf-8",
						"items": 1000
					}
				});
		});
		return requests;
	}
	
	function createPotentialInvites(users) {
		var potentialInvites = {};
		var maxInvitesPerUser = 10;
		var totalUsers = Object.keys(users).length;
		
		for (var sourceUserId in users) {
		  potentialInvites[sourceUserId] = [];
		  
		  // do a "round-robin" search since we want to start at a random location
		  var start = Math.floor(Math.random()*totalUsers);
		  var end = (start == 0) ? totalUsers-1 : start-1; 
		  var userIdKeys = Object.keys(users);

		  var i;
			for (i = start; i != end; i = (i+1)%totalUsers) {
			  var destUserId = userIdKeys[i];
				if (sourceUserId == destUserId)
					continue;
				if (potentialInvites[sourceUserId].length >= maxInvitesPerUser)
				  break;
				potentialInvites[sourceUserId].push(destUserId)
			}
		}
		return potentialInvites;
	}
	
	function deletePotentialInvite(potentialInvites, sourceUserId, destUserId) {
	  var i;
	  for (i = 0; i < potentialInvites[sourceUserId].length; i++) {
	    var potentialDestUserId = potentialInvites[sourceUserId][i];
	    if (potentialDestUserId == destUserId) {
	      potentialInvites[sourceUserId][i] = false;
	    }
	  }
	}
	
});