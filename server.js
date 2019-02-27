const zulip = require('zulip-js');
const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const { nicelyFormatDate, generateDatesArray } = require('./utils');

const DB_FILE = './.data/sqlite.db';
const ADMIN_USERS = [
    "gretchen.m.wright@gmail.com", 
    "pmmhy4@mst.edu",
    "terrykoshea@gmail.com",
];

const ZULIP_CONFIG = {
    username: process.env.ZULIP_USERNAME,
    apiKey: process.env.ZULIP_API_KEY,
    realm: process.env.ZULIP_REALM
};

const CMD_LIST = `Available commands:
· **get free dates** - show dates with no host assigned
· **get my dates** - show dates where I'm signed up to host
· **get schedule** - show the whole calendar for this batch
· **assign N** - assign me to the date with date ID N (run one of the above commands to get the date ID)
· **unassign N** - unassign me to the date with date ID N (run one of the above commands to get the date ID)
`;

const ADMIN_CMD_LIST = `Available admin commands:
· **clear calendar** - delete the entire assignments table - USE WITH CAUTION!
· **start batch yyyy-mm-dd yyyy-mm-dd** - create calendar entries for dates Monday through Thursday that fall between the given dates (inclusive)
----> Example: 'start batch 2019-01-09 2019-02-13' will create entries starting on Wed. Jan 9 and ending Wed. Feb 13.
`;


const app = express();
app.use(bodyParser.json());

const db = new sqlite3.Database(DB_FILE);

// if ./.data/sqlite.db does not exist, create it
db.serialize(() => {
    if (!fs.existsSync(DB_FILE)) {
        db.run(`CREATE TABLE assignments (
            dateNum INTEGER PRIMARY KEY, // TODO: this should be 'dateID'
            dates TEXT NOT NULL, // TODO: this should be 'date'
            email TEXT  
            );`);

        db.serialize(function() {
            db.run('INSERT INTO assignments (dates, email) VALUES ("11/12/18", "gretchen.m.wright@gmail.com")');
            db.run("CREATE INDEX date_index ON assignments (dates)");
            db.run("CREATE INDEX email_index ON assignments (email)");
        });
    }
}); 

app.post("/cron/run", (request, response) => {
    if (request.headers.secret == process.env.SECRET) {
        sendReminder();
    }
    response.status(200).json({ status: "ok" });
});

app.post('/webhook/zulip', (request, response) => {
    handlePrivateMessageToBot(request.body);
    response.status(200).json({ status: "ok" });
});

const sendReminder = async() => {
    const zulipAPI = await zulip(ZULIP_CONFIG);
    db.each('SELECT * FROM assignments WHERE dates=date("now")', (err, row) => {
        if (err) {
            zulipAPI.messages.send({
                to: 'PLP-Hosts',
                type: "stream", 
                subject: "Alert Message Error",
                content: "PLP Bot got an error when trying to send a reminder message to today's host :(.",
            });
        } else if (row) {
            if (row.email) {
                zulipAPI.messages.send({
                    to: row.email,
                    type: "private",
                    content: "Hey there! Just a reminder that you're scheduled to host PLP today."
                });     
            } else {
                zulipAPI.messages.send({
                    to: 'PLP-Hosts',
                    type: "stream", 
                    subject: "No Host Warning",
                    content: "Just a heads up, no one is signed up to host PLP today. Please sign up if you are able."
                });
            }
        }
    });
}

const handlePrivateMessageToBot = async (body) => {
    const zulipAPI = await zulip(ZULIP_CONFIG);
    const message = body.data;
    const fromEmail = body.message.sender_email;

    const sendPrivateZulipMessage = message => zulipAPI.messages.send({
        to: fromEmail,
        type: "private",
        content: message,
    });
  
    const checkAdmin = fn => {
        if (ADMIN_USERS.includes(fromEmail)) {
            fn();
        } else {
            sendPrivateZulipMessage("Sorry, you have to be an admin to do that.");
        }
    };
  
    const catchDBError = fn => (err, rows) => {
        if (err) {
            sendPrivateZulipMessage("Sorry, there was a database error.");
        } else {
            fn(rows);
        }
    };

    if (message === "help") {
        sendPrivateZulipMessage(CMD_LIST);
    } else if (message === "help-admin") {
        sendPrivateZulipMessage(ADMIN_CMD_LIST);
    } else if (message === "get free dates") {
        db.all(
            'SELECT dateNum, dates FROM assignments WHERE email is NULL AND date(dates) > date("now")',
            catchDBError(rows => {
                if (rows.length) {
                    const dates = rows
                        .slice(0, 10)
                        .map(row => `**${nicelyFormatDate(row.dates)}**\nID: ${row.dateNum}\n`)
                        .join("\n");
                    sendPrivateZulipMessage(`Here are the unassigned dates: \n${dates}`);
                } else {
                    sendPrivateZulipMessage("No free dates found.");
                }
            })
        );
    } else if (message === "get schedule") {
        db.all('SELECT * FROM assignments WHERE date(dates) >= date("now")', catchDBError(rows => {
            if (rows.length) {
                const dates = rows
                    .slice(0, 7)
                    .map(row => `**${nicelyFormatDate(row.dates)}**\nHost: ${row.email || "Nobody"}\nID: ${row.dateNum}\n`)
                    .join("\n");
                sendPrivateZulipMessage(`Here is the schedule:\n${dates}`);
            } else {
                sendPrivateZulipMessage("No dates found.");
            }
        }));
    } else if (message === "get my dates") {
        db.all(
            `SELECT dateNum, dates FROM assignments WHERE email=="${fromEmail}" AND date(dates) >= date("now")`, 
            catchDBError(rows => {
                if (rows.length) {
                    const dates = rows
                        .map(row => `**${nicelyFormatDate(row.dates)}**\nID: ${row.dateNum}\n`)
                        .join("\n");
                    sendPrivateZulipMessage(`Here are your assigned dates: \n${dates}`);
                } else {
                    sendPrivateZulipMessage("You have no PLP dates assigned to you.");
                }
            })
        );
    } else if (message === "clear calendar") {
        checkAdmin(() => db.run("DROP TABLE IF EXISTS assignments"));
    } else if (message.startsWith("assign")) {
        const assign_split = message.split(" ");
        if (assign_split.length !== 2 || !isNaN(assign_split[1])) {
            const dateNum = parseInt(assign_split[1]);
            db.all(`SELECT * FROM assignments WHERE dateNum="${dateNum}"`, catchDBError(rows => {
                if (rows) {
                    if (rows[0].email) {
                        sendPrivateZulipMessage(`Looks like that day's PLP is already being hosted by ${rows[0].email}`);
                    } else {
                        db.run(`UPDATE assignments SET email="${fromEmail}" WHERE dateNum="${dateNum}"`);
                        sendPrivateZulipMessage(`You've been assigned as the PLP host for ${rows[0].dates}`);
                    }
                } else {
                    sendPrivateZulipMessage("Invalid date ID.");
                }
            }));
        } else {
            sendPrivateZulipMessage("Sorry, your assignment command is invalid.");
        }
    } else if (message.startsWith("unassign")) {
        const unassign_split = message.split(" ");
        if (unassign_split.length !== 2 || !isNaN(unassign_split[1])) {
            const dateNum = parseInt(unassign_split[1]);
            db.all(`SELECT * FROM assignments WHERE dateNum="${dateNum}"`, catchDBError(rows => {
                if (rows) {
                    if (rows[0].email) {
                        if (rows[0].email == fromEmail) {
                            db.run(`UPDATE assignments SET email=NULL WHERE dateNum=${dateNum}`);
                            sendPrivateZulipMessage(`All right all right all right, you're no longer hosting PLP on ${rows[0].dates}`);
                        } else {
                            sendPrivateZulipMessage(`Someone else (${rows[0].email}) is hosting PLP that day and only that person can unassign.`);
                        }
                    } else {
                        sendPrivateZulipMessage("Looks like nobody is assigned to that date ID anyway.");
                    }
                } else {
                    sendPrivateZulipMessage("Invalid date ID.");
                }
            }));
        } else {
            sendPrivateZulipMessage("Sorry, your unassignment command is invalid.");
        }
    } else if (message.startsWith("start batch")) {
        checkAdmin(() => {
            const startBatchMatch = message.match(/^start\sbatch\s(\d+-\d+-\d+)\s(\d+-\d+-\d+)$/);
            if (startBatchMatch) {
                const startDate = new Date(`${startBatchMatch[1]} GMT-05:00`);
                const endDate = new Date(`${startBatchMatch[2]} GMT-05:00`);
                const dates = generateDatesArray(startDate, endDate);

                db.serialize(() => dates.forEach(date => {
                    const day = date.toLocaleDateString('en-US', {'day': '2-digit'});
                    const month = date.toLocaleDateString('en-US', {'month': '2-digit'});
                    const year = date.getYear() + 1900;
                    const formattedDateString = `${year}-${month}-${day}`;
                    db.run(`INSERT OR REPLACE INTO assignments(dates) VALUES (date('${formattedDateString}'))`);
                }));

                sendPrivateZulipMessage(`Created batch with start date ${startDate} and end date ${endDate}`);
            } else {
                sendPrivateZulipMessage("Sorry, your start batch command is invalid.");
            }
        });
    } else {
        sendPrivateZulipMessage(`I could not find a valid command. Please try again.\n${CMD_LIST}`);
    }
}

const listener = app.listen(process.env.PORT, () => {
    console.log(`Your app is listening on port ${listener.address().port}`);
});
