require("dotenv").config();
const sqlite3 = require("sqlite3").verbose();
const OBSWebSocket = require("obs-websocket-js");
const tmi = require("tmi.js");
const animalNames = require("./AnimalNames");

// Define configuration options
const opts = {
  identity: {
    username: process.env.TWITCH_BOT_USERNAME,
    password: process.env.TWITCH_OAUTH_TOKEN,
  },
  channels: [process.env.TWITCH_CHANNEL],
};

// Create a client with options
const client = new tmi.client(opts);

// Register event handlers (defined below)
client.on("message", onMessageHandler);
client.on("connected", onConnectedHandler);

// Connect to Twitch
client.connect();

// Connect to the SQLite database
const db = new sqlite3.Database("./userDB.db");

/*
// Connect to OBS WebSocket
const obs = new OBSWebSocket();
obs
  .connect({
    address: "localhost:4444",
    password: process.env.OBS_WEBSOCKET_PASSWORD,
  })
  .then(() => {
    console.log("Connected to OBS WebSocket.");
  })
  .catch((err) => {
    console.error("Failed to connect to OBS WebSocket:", err);
  });
  */

// Map to store last command times for each user
const lastCommandTimes = new Map();
let transformedUsers = new Map();

// Function to handle check-in logic
function handleCheckin(username, callback) {
  const now = new Date();
  const nowISO = now.toISOString();

  db.get(
    `SELECT * FROM checkins WHERE username = ?`,
    [username],
    (err, row) => {
      if (err) {
        console.error(err.message);
        callback(`@${username}, an error occurred. Please try again later.`);
        return;
      }

      if (row) {
        const lastCheckin = new Date(row.lastCheckin);
        const timeDifference = now - lastCheckin;
        const oneDay = 24 * 60 * 60 * 1000;

        if (timeDifference > oneDay) {
          // Update streak and lastCheckin
          const newStreak = row.streak + 1;
          db.run(
            `UPDATE checkins SET streak = ?, lastCheckin = ? WHERE username = ?`,
            [newStreak, nowISO, username],
            function (err) {
              if (err) {
                console.error(err.message);
                callback(
                  `@${username}, an error occurred. Please try again later.`
                );
              } else {
                //triggerCheckinAnimation(username);
                callback(
                  `@${username} has checked in! You're currently on a ${newStreak} day streak.`
                );
              }
            }
          );
        } else {
          callback(
            `@${username}, you have already checked in today. Please try again later!`
          );
        }
      } else {
        // Insert new user record
        db.run(
          `INSERT INTO checkins (username, streak, lastCheckin) VALUES (?, ?, ?)`,
          [username, 1, nowISO],
          function (err) {
            if (err) {
              console.error(err.message);
              callback(
                `@${username}, an error occurred. Please try again later.`
              );
            } else {
              //triggerCheckinAnimation(username);
              callback(
                `@${username}, you have checked in for the first time! Your current streak is 1 day.`
              );
            }
          }
        );
      }
    }
  );
}

/*
// Function to trigger check-in animation in OBS
function triggerCheckinAnimation(username) {
  obs.send("SetSceneItemProperties", {
    "scene-name": "CheckinAnimation",
    item: "CheckinText",
    visible: true,
  });

  obs.send("SetTextGDIPlusProperties", {
    source: "CheckinText",
    text: `${username} has checked in!`,
  });

  setTimeout(() => {
    obs.send("SetSceneItemProperties", {
      "scene-name": "CheckinAnimation",
      item: "CheckinText",
      visible: false,
    });
  }, 5000); // Adjust the duration as needed
}
  */

// Called every time a message comes in
function onMessageHandler(target, context, msg, self) {
  // Ignore messages from the bot
  if (self) {
    return;
  }

  // Remove whitespace from chat message
  const commandName = msg.trim().toLowerCase();
  const username = context["display-name"] || context["username"];

  // Generate random index in Animal Name Array
  function getRandomAnimal(array) {
    const randomIndex = Math.floor(Math.random() * array.length);
    return array[randomIndex];
  }

  // Function to generate a random transform duration between 2 minutes and 1 week (in milliseconds)
  function getRandomTransformDuration() {
    const minMinutes = 2;
    const maxMinutes = 7 * 24 * 60; // 7 days
    const randomMinutes =
      Math.floor(Math.random() * (maxMinutes - minMinutes + 1)) + minMinutes;
    const durationMilliseconds = randomMinutes * 60 * 1000; // Convert minutes to milliseconds
    return durationMilliseconds;
  }

  // If the command is known, execute it
  if (commandName === "!tf") {
    if (transformedUsers.has(username)) {
      // User is already transformed
      const transformEnd = transformedUsers.get(username);
      const remainingTime = getRemainingTime(transformEnd);

      getAnimalFromDatabase(username, (animal) => {
        client.say(
          target,
          `@${username} is currently TF'd into a ${animal} for ${remainingTime}.`
        );
      });
    } else {
      const randomAnimal = getRandomAnimal(animalNames);
      const transformDuration = getRandomTransformDuration();

      const now = new Date();
      const transformEnd = new Date(now.getTime() + transformDuration);
      const remainingTime = getRemainingTime(transformEnd);

      // Update database with transformation details
      db.run(
        `UPDATE checkins SET animal = ?, transform_start = ?, transform_end = ? WHERE username = ?`,
        [randomAnimal, now.toISOString(), transformEnd.toISOString(), username],
        function (err) {
          if (err) {
            console.error(err.message);
            client.say(target, `@${username}, an error occurred.`);
          } else {
            // Add user to transformed users map
            transformedUsers.set(username, transformEnd);

            // Inform user about transformation
            client.say(
              target,
              `${username} has TF'd into a ${randomAnimal} for the next ${remainingTime}.`
            );
          }
        }
      );
    }
  } else if (commandName === "!checkin") {
    handleCheckin(username, (response) => {
      client.say(target, response);
      console.log(
        `* Executed ${commandName} command for ${username}. ${response}`
      );
    });
  } else {
    console.log(`Unknown command ${commandName}`);
  }
}

// Periodically check and clear expired transformations
setInterval(() => {
  const now = new Date();
  for (const [username, transformEnd] of transformedUsers.entries()) {
    if (now > transformEnd) {
      transformedUsers.delete(username);
      // Update database to clear transformation details
      db.run(
        `UPDATE checkins SET animal = NULL, transform_start = NULL, transform_end = NULL WHERE username = ?`,
        [username],
        function (err) {
          if (err) {
            console.error(err.message);
          }
        }
      );
    }
  }
}, 60000); // Check every minute (adjust as needed)

function getRemainingTime(transformEnd) {
  const now = new Date();
  const remainingMilliseconds = transformEnd - now;

  if (remainingMilliseconds <= 0) {
    return "none";
  }

  const seconds = Math.floor((remainingMilliseconds / 1000) % 60);
  const minutes = Math.floor((remainingMilliseconds / (1000 * 60)) % 60);
  const hours = Math.floor((remainingMilliseconds / (1000 * 60 * 60)) % 24);
  const days = Math.floor(remainingMilliseconds / (1000 * 60 * 60 * 24));

  let remainingTime = "";
  if (days > 0) remainingTime += `${days} day${days > 1 ? "s" : ""}, `;
  if (hours > 0) remainingTime += `${hours} hour${hours > 1 ? "s" : ""}, `;
  if (minutes > 0)
    remainingTime += `${minutes} minute${minutes > 1 ? "s" : ""}, `;
  remainingTime += `${seconds} second${seconds !== 1 ? "s" : ""}`;

  return remainingTime;
}

function getAnimalFromDatabase(username, callback) {
  db.get(
    `SELECT animal FROM checkins WHERE username = ?`,
    [username],
    (err, row) => {
      if (err) {
        console.error("Error retrieving animal from database:", err.message);
        callback("unknown"); // Return a default value on error
      } else {
        callback(row ? row.animal : "unknown");
      }
    }
  );
}

// Function to load transformation state from database on bot startup
function loadTransformedUsers() {
  const query = `SELECT username, transform_end FROM checkins WHERE transform_end > ?`;
  const now = new Date().toISOString();

  db.all(query, [now], (err, rows) => {
    if (err) {
      console.error("Error loading transformed users:", err.message);
      return;
    }

    rows.forEach((row) => {
      const username = row.username;
      const transformEnd = new Date(row.transform_end);

      transformedUsers.set(username, transformEnd);
    });

    console.log("Transformed users loaded from database:", transformedUsers);
  });
}
// Call loadTransformedUsers() when the bot starts up
loadTransformedUsers();

// Called every time the bot connects to Twitch chat
function onConnectedHandler(addr, port) {
  console.log(`* Connected to ${addr}:${port}`);
}
