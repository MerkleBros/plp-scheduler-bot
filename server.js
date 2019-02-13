const zulip = require("zulip-js");

const zulipConfig = {
  username: process.env.ZULIP_USERNAME,
  apiKey: process.env.ZULIP_API_KEY,
  realm: process.env.ZULIP_REALM
};

var express = require('express');
var bodyParser = require('body-parser');
var app = express();
app.use(bodyParser.json());
app.use(express.static('public'));

// init sqlite db
var fs = require('fs');
var dbFile = './.data/sqlite.db';
var exists = fs.existsSync(dbFile);
var sqlite3 = require('sqlite3').verbose();
var db = new sqlite3.Database(dbFile);
var adminUser = "gretchen.m.wright@gmail.com"

// if ./.data/sqlite.db does not exist, create it, otherwise print records to console
db.serialize(function(){
  if (!exists) {
    db.run(`CREATE TABLE users (
              user TEXT,
              email TEXT NOT NULL  
           );`);
    
    console.log('New table users created!');
    db.run(`CREATE TABLE assignments (
              dateNum INTEGER,
              dates TEXT NOT NULL,
              user TEXT,
              email TEXT  
           );`);
    console.log('New table assignments created!');

    db.serialize(function() {
      db.run('INSERT INTO users (user, email) VALUES ("Gretchen", "gretchen.m.wright@gmail.com")');
      db.run('INSERT INTO assignments (dates, email) VALUES ("11/12/18", "gretchen.m.wright@gmail.com")');

      db.run("CREATE INDEX date_index ON assignments (dates)");
      db.run("CREATE INDEX email_index ON assignments (email)");
      
    });
      

  }
  else {
    // db.run(`CREATE TABLE assignments (
    //           dateNum INTEGER PRIMARY KEY AUTOINCREMENT,
    //           dates TEXT NOT NULL,
    //           user TEXT,
    //           email TEXT  
    //        );`);
    // db.run("DROP TABLE IF EXISTS assignments");

    //db.run("UPDATE assignments set email=  'gretchen.m.wright@gmail.com' WHERE dates = date('now')");
    // db.run("DELETE FROM assignments  WHERE email = 'gretchen.m.wright@gmail.com'");
    // db.run("INSERT OR REPLACE INTO assignments(dates, email) VALUES (date('now'), 'gretchen.m.wright@gmail.com')");
    // db.run("INSERT OR REPLACE INTO assignments(dates) VALUES (date('now', '+1 day'))");
    
    // db.run("INSERT OR REPLACE INTO assignments(dates) VALUES (date('2019-01-09'))");
    // db.run("INSERT OR REPLACE INTO assignments(dates=) VALUES (date('now','weekday 2'))");
    // db.run("UPDATE assignments SET email=? WHERE dateNum=?;", null, parseInt(12));
    
    console.log('Database ready to go!');
    db.each('SELECT * from assignments', function(err, row) {
      if ( row ) {
        console.log('record:', row.dates + ' | ' + row.email + ' | ' + row.dateNum);
      }
    });


    
  }
}); 

// http://expressjs.com/en/starter/basic-routing.html
app.get('/', function(request, response) {
  response.sendFile(__dirname + '/views/index.html');
});

app.get('/calendar', function(request, response) {
  response.sendFile(__dirname + '/views/my.html');
});

app.post('/add/dates', function(request, response) {
  // save to db
});

// endpoint to get all the dreams in the database
// currently this is the only endpoint, ie. adding dreams won't update the database
// read the sqlite3 module docs and try to add your own! https://www.npmjs.com/package/sqlite3

// app.get('/getDreams', function(request, response) {
//   db.all('SELECT * from Dreams', function(err, rows) {
//     response.send(JSON.stringify(rows));
//   });
// });

app.post("/cron/run", function(request, response) {
  console.log("Running the reminder");
  if (request.headers.secret == process.env.SECRET) {
    // method to send the reminder
    sendReminder();
  }
  response.status(200).json({ status: "ok" });
});



const sendReminder = async() => {
  console.log('sending a reminder');
  const zulipAPI = await zulip(zulipConfig);
  db.each('SELECT * from assignments where dates=date("now")', function(err, row) {

    if ( row ) {
         if (row.email != null) {
            zulipAPI.messages.send({
                to: row.email,
                type: "private",
                content: "Hey there! Just a reminder that you're scheduled to host PLP today!"
            });     
         }
         else {
            zulipAPI.messages.send({
                to: 'PLP-Hosts',
                type: "stream", 
                subject: "No Host Warning",
                content: "Hey there! Just a heads up, no one is signed up to host PLP today. Please sign up if you are able."
            });
         }
     }
  });
}


app.post('/webhook/zulip', function(request, response) {
  console.log(request);
  // response.sendFile(__dirname + '/views/index.html');
  handlePrivateMessageToBot(request.body);
  response.status(200).json({ status: "ok" });
});

//TODO:ADD PROMISE TO insertDates
function insertDates(start,end) {
  var generateDatesArray = function(startOne, endOne) {
    let plpDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday']

    let
      arr = new Array(),
      dt = new Date(startOne);

    while (dt <= endOne) {
      let weekDay = dt.toLocaleDateString('en-EN', {'weekday': 'long'})
      if(plpDays.includes(weekDay)) {
        arr.push(new Date(dt));
      }
      dt.setDate(dt.getDate() + 1);
    }

    return arr;
  }

  let startDate = new Date(start)
  let endDate = new Date(end)

  let dates = generateDatesArray(startDate,endDate)

  let sqlCommandsArray = []
  let cmdArray = [];
  dates.forEach(
    (date) => {
      let day = date.toLocaleDateString('en-EN', {'day': '2-digit'})
      let month = date.toLocaleDateString('en-EN', {'month': '2-digit'})
      let year = date.getYear() + 1900
      let cmd = "INSERT OR REPLACE INTO assignments(dates) VALUES (date('" + year + "-" + month + "-" + day + "'))";
      cmdArray.push(cmd)
  })
  db.serialize(function() {
    cmdArray.forEach(
      (cmd) => {
        db.run(cmd)
      }
    )
  })
} 

const handlePrivateMessageToBot = async (body) => {
  console.log("handlePrivateMessageToBot", body);
  const zulipAPI = await zulip(zulipConfig);
  const message = body.data;
  const fromEmail = body.message.sender_email;
  
  const cmdList = "Available commands:\n" +
        "get free dates - show dates with no host assigned\n" +
        "get my dates - show dates where I'm signed up to host\n" +
        "get schedule - show the whole calendar for this batch\n" +
        "assign N - assign me to the date with date number N (run one of the above commands to get the date number)\n" +
        "unassign N - unassign me to the date with date number N (run one of the above commands to get the date number)\n"
  
  const adminCmdList = "Available admin commands:\n" +
        "clear calendar - delete the entire assignments table - USE WITH CAUTION!\n" +
        "start batch yyyy-mm-dd yyyy-mm-dd - create calendar entries for dates Monday through Thursday that fall between the given dates (inclusive)\n" +
        "\tExample: 'start batch 2019-01-09 2019-02-13' will create entries starting on Wed. Jan 9 and ending Wed. Feb 13.\n"
  
  if (message == "help") {
    zulipAPI.messages.send({
      to: fromEmail,
      type: "private", 
      content: cmdList
    });
    return;
  }
  
  if (message == "help-admin") {
   zulipAPI.messages.send({
     to: fromEmail,
     type: "private",
     content: adminCmdList
   });
    return;
  }

  if (message=="get free dates") {
    var result = "";
    db.all('SELECT dateNum, dates from assignments WHERE email is NULL', function(err, rows) {
      if ( rows ) {
        
        for (let i in rows) {
          console.log(rows[i]);
          result = result + "\n" +
            rows[i].dateNum + " : " + rows[i].dates;        
        }
      }
      result = 'Here are the unassigned dates: ' + result;
      // TODO: can send markdown formatted messages
      // result = `|| yes | no | ` + result +
      //          `|---|---|:---:|------:
      //           | A | left-aligned | centered | right-aligned`;
      zulipAPI.messages.send({
        to: fromEmail,
        type: "private",
        content: result
      });
    });
    return;
  } 
  
  if (message=='get schedule') {
    var result = "";
    db.all('SELECT * FROM assignments', function(err, rows) {
      if (rows) {
        for (let i in rows){
          result = result + '\n' + rows[i].dateNum + " : " + rows[i].dates + " : " + rows[i].email;
        }
      }
      result = 'Here is the schedule: ' + result
      zulipAPI.messages.send({
        to: fromEmail,
        type: "private",
        content: result
      });
    });
    return;
  }
  
  if (message=="get my dates") {
      var result = "";
      var cmd = "SELECT dateNum, dates from assignments WHERE email=='" + fromEmail + "'";
      console.log(cmd)
      db.all(cmd, function(err, rows) {
        if ( rows ) {

          for (let i in rows) {
            console.log(rows[i]);
            result = result + "\n" +
              rows[i].dateNum + " : " + rows[i].dates;        
          }
        }
        result = 'Here are your assigned dates: ' + result;
        // TODO: can send markdown formatted messages
        // result = `|| yes | no | ` + result +
        //          `|---|---|:---:|------:
        //           | A | left-aligned | centered | right-aligned`;
        zulipAPI.messages.send({
          to: fromEmail,
          type: "private",
          content: result
        });
      });
      return;
  } 
  
  // user sends "assign 9" message to assign himself for the date with id=9
  const assignmentMatch = message.match(/^assign\s(\d+)$/);

  if (assignmentMatch) {
    const dateNum = assignmentMatch[1];
    db.all('SELECT * from assignments WHERE dateNum=' + parseInt(dateNum) + " AND EMAIL IS NULL", function(err, rows) {
      if (rows) {
         db.run("UPDATE assignments SET email=? WHERE dateNum=?;", fromEmail, parseInt(dateNum));
      
        zulipAPI.messages.send({
          to: fromEmail,
          type: "private",
          content: "You've been assigned as a PLP host for " + rows[0].dates 
        });
      } else {
        zulipAPI.messages.send({
          to: fromEmail,
          type: "private",
          content: "The index you requested seems wrong =( Either that date isn't valid for this batch, or it's already assigned. Please try again. " + "\n" + cmdList
        });
      }
    });
    return;
  }
  
  //TODO: ADD REPORTING WHEN USER CHANGES THE CALENDAR (send message to stream)
  // user sends "unassign 9" message to unassign himself from the date with id=9
  const unassignmentMatch = message.match(/^unassign\s(\d+)$/);
  if (unassignmentMatch) {
    const dateNum = unassignmentMatch[1];
    console.log(dateNum + fromEmail);
    db.all("SELECT * from assignments where dateNum=" + parseInt(dateNum) + " AND email='" + fromEmail + "'", function(err, rows) {
      if (rows) {
        console.log(rows[0]);
        db.run("UPDATE assignments SET email=? WHERE dateNum=?;", null, parseInt(dateNum));
        zulipAPI.messages.send({
          to: fromEmail,
          type: "private",
          content: "You are no longer assigned as a PLP host for " + rows[0].dates 
        });
      } 
      else {
        zulipAPI.messages.send({
          to: fromEmail,
          type: "private",
          content: "You do not appear to be assigned for that date. Please try again. "  + "\n" + cmdList
        });
      }
    });
    return;
  }
  
  //#################################### ADMIN COMMANDS ###############################################
  //TODO:TEST CLEAR CALENDAR COMMAND
  //TODO:RECREATE TABLE AFTER CLEARING CALENDAR
  if (message == 'clear calendar') {
    if (fromEmail == adminUser) {
      db.run("DROP TABLE IF EXISTS assignments");
    }
    // TODO: send message with error and explanation
  }
  
  //TODO:WRAP DATE CREATION SO ONLY ADMIN CAN ADD BATCH DATES
  //TODO:VALIDATE START AND END DATES 
  // admin user sends "start batch 2018-01-01 2018-03-03" message to add PLP dates from 2018-01-01 to 2018-03-03
  const startBatchMatch = message.match(/^start\sbatch\s(\d+-\d+-\d+)\s(\d+-\d+-\d+)$/);

  if (startBatchMatch) {
    const startDate = startBatchMatch[1];
    const endDate = startBatchMatch[2];
    
    insertDates(startDate, endDate) 
  
    zulipAPI.messages.send({
      to: fromEmail,
      type: "private",
      content: "Created batch with startDate " + startDate + " and endDate " + endDate
    });

    return;
  }
  
  //#################################### END ADMIN COMMANDS ###############################################

  // no matches
  zulipAPI.messages.send({
          to: fromEmail,
          type: "private",
          content: "I could not find a valid command. Please try again."  + "\n" + cmdList
        });
  
// NOT USED YET
//   const creationMatch = message.match(/^create calendar (.*)$/);
//   if (creationMatch){
//     const dateMatch = creationMatch[1].match(/^(\d\d\d\d)-(\d\d)-(\d\d)$/);
//     if (dateMatch){
//       //generate all valid dates from now to _date_ 
//       //for each date only insert into 'assignments' if the corresponding date does not already exist
//       var endDate = new Date();
//       endDate.setFullYear(dateMatch[1]);
//       endDate.setMonth(parseInt(dateMatch[2]) - 1);
//       endDate.setDate(dateMatch[3]);
//       //get list of dates that already exist
      
//       // TODO: only grab those that are between today and endDate
//       db.all('SELECT dates FROM assignments', function(err, rows){
//         const existing_dates = rows.map(v => v.dates);
//         console.log("existing_dates: ", existing_dates);
//         var dates_to_add = [];
//         //add each date between now and 'date'
//         var curDate = new Date();
//         while (curDate <= endDate){
//             console.log(curDate);
//           // need to check doesn't already exist
//             if (!existing_dates.includes(curDate) ){
//               dates_to_add.push(curDate)
//             }
//           // TODO: generate date in sqlite:
// //             INSERT INTO memos(id,text) 
// // SELECT 5, 'text to insert' 
// // WHERE NOT EXISTS(SELECT 1 FROM memos WHERE id = 5 AND text = 'text to insert');
  
//           curDate.setDate(curDate.getDate + 1); //TODO: exclude all but Mon thru Thur
//         }
//         console.log(dates_to_add);
//         for (let i in dates_to_add) {
//             db.run("INSERT INTO assignments(dates) VALUES (?)", dates_to_add[i]);
//         }
//       });
//     }
//     else{
//       zulipAPI.messages.send({
//         to: fromEmail,
//         type: "private",
//         content: "The end date seems to be in a wrong format. Correct format is yyyy-mm-dd. Please, try again! " 
//       });
//     }
//   }
}
// listen for requests :)
var listener = app.listen(process.env.PORT, function() {
  console.log('Your app is listening on port ' + listener.address().port);
});
