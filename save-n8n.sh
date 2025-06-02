#!/bin/bash

# Get computer name for commit message
COMPUTER_NAME=$(scutil --get ComputerName)

# Add all changes
git add .

# Commit with computer name and timestamp
git commit -m "Update from $COMPUTER_NAME at $(date)"

# Push to remote (if you have one)
git push

echo "✅ Changes saved successfully!" 