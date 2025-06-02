#!/bin/bash

# Pull latest changes
git pull

echo "✅ Changes loaded successfully!"
echo "Recent changes:"
git log --oneline -n 5 