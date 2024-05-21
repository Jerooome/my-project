// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license.

// Global objects
var peerConnection
var previousAnimationFrameTimestamp = 0;

// Logger
const log = msg => {
    document.getElementById('logging').innerHTML += msg + '<br>'
}

// Setup WebRTC
function setupWebRTC(iceServerUrl, iceServerUsername, iceServerCredential) {
    // Create WebRTC peer connection
    peerConnection = new RTCPeerConnection({
        iceServers: [{
            urls: [ iceServerUrl ],
            username: iceServerUsername,
            credential: iceServerCredential
        }]
    })

    // Fetch WebRTC video stream and mount it to an HTML video element
    peerConnection.ontrack = function (event) {
        // Clean up existing video element if there is any
        remoteVideoDiv = document.getElementById('remoteVideo')
        for (var i = 0; i < remoteVideoDiv.childNodes.length; i++) {
            if (remoteVideoDiv.childNodes[i].localName === event.track.kind) {
                remoteVideoDiv.removeChild(remoteVideoDiv.childNodes[i])
            }
        }

        const mediaPlayer = document.createElement(event.track.kind)
        mediaPlayer.id = event.track.kind
        mediaPlayer.srcObject = event.streams[0]
        mediaPlayer.autoplay = true
        document.getElementById('remoteVideo').appendChild(mediaPlayer)
        document.getElementById('overlayArea').hidden = false

        if (event.track.kind === 'video') {
            mediaPlayer.playsInline = true
            remoteVideoDiv = document.getElementById('remoteVideo')
            canvas = document.getElementById('canvas')
            
            canvas.hidden = true
            

            mediaPlayer.addEventListener('play', () => {
                
                remoteVideoDiv.style.width = mediaPlayer.videoWidth / 2 + 'px'
                
            })
        }
        else
        {
            // Mute the audio player to make sure it can auto play, will unmute it when speaking
            // Refer to https://developer.mozilla.org/en-US/docs/Web/Media/Autoplay_guide
            mediaPlayer.muted = true
        }
    }

    // Make necessary update to the web page when the connection state changes
    peerConnection.oniceconnectionstatechange = e => {
        log("WebRTC status: " + peerConnection.iceConnectionState)

        if (peerConnection.iceConnectionState === 'connected') {
            document.getElementById('stopSession').disabled = false
            document.getElementById('speak').disabled = false
        }

        if (peerConnection.iceConnectionState === 'disconnected' || peerConnection.iceConnectionState === 'failed') {
            document.getElementById('speak').disabled = true
            document.getElementById('stopSession').disabled = true
            document.getElementById('startSession').disabled = false
        }
    }

    // Offer to receive 1 audio, and 1 video track
    peerConnection.addTransceiver('video', { direction: 'sendrecv' })
    peerConnection.addTransceiver('audio', { direction: 'sendrecv' })

    // Set local description
    peerConnection.createOffer().then(sdp => {
        peerConnection.setLocalDescription(sdp).then(() => { setTimeout(() => { connectToAvatarService(peerConnection) }, 1000) })
    }).catch(log)
}

// Connect to TTS Avatar Service
function connectToAvatarService(peerConnection) {
    const xhr = new XMLHttpRequest()
    xhr.open("POST", "/api/connectAvatar")

    xhr.setRequestHeader("LocalSdp", btoa(JSON.stringify(peerConnection.localDescription)))
    xhr.setRequestHeader("AvatarCharacter", "lisa")
    xhr.setRequestHeader("AvatarStyle", "casual-sitting")
    xhr.setRequestHeader("BackgroundColor", "#FFFFFFFF")

    let responseReceived = false
    xhr.addEventListener("readystatechange", function() {
        if (xhr.status == 200) {
            if (xhr.responseText !== '') {
                if (!responseReceived) {
                    responseReceived = true
                    const remoteSdp = this.responseText
                    peerConnection.setRemoteDescription(new RTCSessionDescription(JSON.parse(atob(remoteSdp))))
                }
            }
        } else {
            if (xhr.responseText !== '') {
                if (!responseReceived) {
                    responseReceived = true
                    console.log("Failed to connect to the Avatar service. " + xhr.responseText)

                    document.getElementById('startSession').disabled = false;
                }
            }
        }
    })
    xhr.send()
}

// Make video background transparent by matting
function makeBackgroundTransparent(timestamp) {
    // Throttle the frame rate to 30 FPS to reduce CPU usage
    if (timestamp - previousAnimationFrameTimestamp > 30) {
        video = document.getElementById('video')
        tmpCanvas = document.getElementById('tmpCanvas')
        tmpCanvasContext = tmpCanvas.getContext('2d', { willReadFrequently: true })
        tmpCanvasContext.drawImage(video, 0, 0, video.videoWidth, video.videoHeight)
        if (video.videoWidth > 0) {
            let frame = tmpCanvasContext.getImageData(0, 0, video.videoWidth, video.videoHeight)
            for (let i = 0; i < frame.data.length / 4; i++) {
                let r = frame.data[i * 4 + 0]
                let g = frame.data[i * 4 + 1]
                let b = frame.data[i * 4 + 2]
                if (g - 150 > r + b) {
                    // Set alpha to 0 for pixels that are close to green
                    frame.data[i * 4 + 3] = 0
                } else if (g + g > r + b) {
                    // Reduce green part of the green pixels to avoid green edge issue
                    adjustment = (g - (r + b) / 2) / 3
                    r += adjustment
                    g -= adjustment * 2
                    b += adjustment
                    frame.data[i * 4 + 0] = r
                    frame.data[i * 4 + 1] = g
                    frame.data[i * 4 + 2] = b
                    // Reduce alpha part for green pixels to make the edge smoother
                    a = Math.max(0, 255 - adjustment * 4)
                    frame.data[i * 4 + 3] = a
                }
            }

            canvas = document.getElementById('canvas')
            canvasContext = canvas.getContext('2d')
            canvasContext.putImageData(frame, 0, 0);
        }

        previousAnimationFrameTimestamp = timestamp
    }

    window.requestAnimationFrame(makeBackgroundTransparent)
}

// Do HTML encoding on given text
function htmlEncode(text) {
    const entityMap = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
        '/': '&#x2F;'
    };

    return String(text).replace(/[&<>"'\/]/g, (match) => entityMap[match])
}

window.startSession = () => {
    document.getElementById('startSession').disabled = true
    document.getElementById('stopSession').disabled = false
    document.getElementById('speak').disabled = false
        
    const xhr = new XMLHttpRequest()
    xhr.open("GET", "/api/getIceToken")

    let responseReceived = false
    xhr.addEventListener("readystatechange", function() {
        if (xhr.status == 200) {
            if (xhr.responseText !== '') {
                if (!responseReceived) {
                    responseReceived = true
                    const responseData = JSON.parse(this.responseText)
                    const iceServerUrl = responseData.Urls[0]
                    const iceServerUsername = responseData.Username
                    const iceServerCredential = responseData.Password
                    setupWebRTC(iceServerUrl, iceServerUsername, iceServerCredential)
                }
            }
        } else {
            if (xhr.responseText !== '') {
                if (!responseReceived) {
                    responseReceived = true
                    console.log("[" + (new Date()).toISOString() + "] Failed fetching ICE token. " + xhr.responseText)
                }
            }
        }
    })
    xhr.send()

    fetch('/convid')
        .then(response => {
            if (!response.ok) {
                throw new Error('Failed to fetch from /convid: ' + response.statusText);
            }
            return response.json();
        })
        .then(chatData => {
            localStorage.setItem('directLineToken', chatData.token);
            localStorage.setItem('conversationId', chatData.conversation_id);
            localStorage.setItem('timeavailability',chatData.expires_in);
            console.log('Credentials stored successfully');
        })
        .catch(error => console.error('Error fetching chat credentials:', error)); 
}

function sendToTtsService(message) {
    let ttsVoice = "en-US-JennyMultilingualV2Neural";
    let personalVoiceSpeakerProfileID = "";
    let encodedMessage = htmlEncode(message);
    let spokenSsml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xmlns:mstts='http://www.w3.org/2001/mstts' xml:lang='en-US'><voice name='${ttsVoice}'><mstts:embedding speakerProfileId='${personalVoiceSpeakerProfileID}'><mstts:leadingSilenceExact value='0'/>${encodedMessage}</mstts:embedding></voice></speak>`;
    
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/speak");
    xhr.setRequestHeader('Content-Type', 'application/ssml+xml');
    xhr.addEventListener("readystatechange", function() {
        if (xhr.readyState === XMLHttpRequest.DONE) {
            document.getElementById('speak').disabled = false;
            if (xhr.status === 200) {
                console.log("[" + (new Date()).toISOString() + "] Speech synthesized to speaker for text [ " + spokenText + " ]. Result ID: " + xhr.responseText);
            } else {
                console.error("[" + (new Date()).toISOString() + "] Unable to speak text. " + xhr.responseText);
            }
        }
    });
    xhr.send(spokenSsml);
}


let pollingInterval = null;
let lastMessageContent = ""; // Garder une trace du dernier contenu de message parlé

function pollForNewMessages() {
  fetch('/api/get-latest-message')
    .then(response => response.json())
    .then(data => {
      if (data.message !== lastMessageContent) {
        lastMessageContent = data.message;
        sendToTtsService(data.message);
        const results = document.getElementById('results');
        results.innerHTML += '<div>Bot anwer: ' + data.message + '</div>';
      }
    })
    .catch(error => {
      console.error("[" + (new Date()).toISOString() + "] Erreur lors de la récupération du dernier message:", error);
    });
}

function startPollingForMessages() {
  if (!pollingInterval) {
    pollingInterval = setInterval(pollForNewMessages, 4500);
  }
}

function stopPollingForMessages() {
  if (pollingInterval) {
    clearInterval(pollingInterval); // Arrêter le sondage
    pollingInterval = null;
  }
}

// Attacher les fonctions aux boutons
window.speak = () => {
    document.getElementById('startSession').disabled = true
    document.getElementById('speak').disabled = true;
    document.getElementById('audio').muted = false;

    startPollingForMessages();
}


window.stopSession = () => {
    document.getElementById('stopSession').disabled = true
    document.getElementById('speak').disabled = true

    document.getElementById('audio').muted = true;
    const xhr = new XMLHttpRequest()
    xhr.open("POST", "/api/disconnectAvatar")
    xhr.send()

    stopPollingForMessages();


}



window.updataTransparentBackground = () => {
    if (document.getElementById('transparentBackground').checked) {
        document.body.background = './static/image/background.png'
        document.getElementById('backgroundColor').value = '#00FF00FF'
        document.getElementById('backgroundColor').disabled = true
    } else {
        document.body.background = ''
        document.getElementById('backgroundColor').value = '#FFFFFFFF'
        document.getElementById('backgroundColor').disabled = false
    }
}

window.updatePrivateEndpoint = () => {
    if (document.getElementById('enablePrivateEndpoint').checked) {
        document.getElementById('showPrivateEndpointCheckBox').hidden = false
    } else {
        document.getElementById('showPrivateEndpointCheckBox').hidden = true
    }
}


function sendMessageToBot(message, token, conversationId) {
    const url = `https://directline.botframework.com/v3/directline/conversations/${conversationId}/activities`;

    fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': 'Bearer ' + token,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            type: 'message',
            from: { id: 'user1' },
            text: message
        })
    })
    .then(response => {
        if (!response.ok) {
            throw new Error('Failed to send message: ' + response.statusText);
        }
        return response.json();
    })
    .then(data => console.log('Message sent:', data))
    .catch(err => console.error('Error sending message:', err));
}


window.startbutton = () => {
    fetch('http://localhost:5001/start-recognition', {
        method: 'POST',
    })
    .then(response => {
        if (!response.ok) {
            throw new Error('Failed to fetch from start-recognition: ' + response.statusText);
        }
        return response.json();
    })
    .then(data => {
        const results = document.getElementById('results');
        results.innerHTML += '<div>Recognized Text: ' + data.recognizedText + '</div>';

        const token = localStorage.getItem('directLineToken');
        const conversationId = localStorage.getItem('conversationId');
        if (token && conversationId) {
            sendMessageToBot(data.recognizedText, token, conversationId);
        } else {
            console.error('Token or Conversation ID not found. Please generate credentials first.');
        }
    })
    .catch(error => console.error('Error in voice recognition:', error));
};


