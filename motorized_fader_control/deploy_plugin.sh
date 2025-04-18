#!/bin/bash

#deploy volumio plugin 
# Navigate to the motorized_fader_control directory
cd /data/configuration/system_hardware/motorized_fader_control || { 
    echo "Directory not found"; 
    exit 1; 
}

# Check if config.json exists and remove it
if [ -f "config.json" ]; then
    echo resetting plugin config.json
    rm config.json
    echo "config.json has been removed."
else
    echo "config.json does not exist."
fi

cd ~/volumio-plugins-sources/motorized_fader_control || { 
    echo "Directory not found"; 
    exit 1; 
}
#refresh the plugin //this can take some time
echo "Refreshing plugin..."
volumio plugin refresh
#wait for 10 seconds
sleep 5

#restart volumio
echo "Restarting Volumio..."
volumio vrestart

sleep 1

sudo journalctl -f | grep -e motorized_fader_control -e Fader_Controller -e FaderController