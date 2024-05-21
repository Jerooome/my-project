from flask import Flask, render_template, request, Response, jsonify
import os
import azure.cognitiveservices.speech as speechsdk
import json
from azure.cosmos import CosmosClient, exceptions
import requests
import traceback
from dotenv import load_dotenv
load_dotenv()



app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get("BotSecretKey")  # Set your secret key here
speech_region = os.environ.get('SPEECH_REGION')
speech_key = os.environ.get('SPEECH_KEY')



endpoint = os.environ.get('YOUR_COSMOS_DB_ENDPOINT')
key = os.environ.get('YOUR_COSMOS_DB_KEY')
database_name = os.environ.get('YourDatabaseName')
container_name = os.environ.get('YourContainerName')

# Azure cosmo DB setup and connection
client = CosmosClient(endpoint, key)
database = client.get_database_client(database_name)
container = database.get_container_client(container_name)

@app.route('/')
def index():
    return render_template('index.html', methods=["GET"])


# The API route to get the ICE token
@app.route("/api/getIceToken", methods=["GET"])
def getIceToken() -> Response:
    global ice_token
    try:
        private_endpoint = request.headers.get('PrivateEndpoint')
        ice_token = getIceTokenInternal(private_endpoint)
        if ice_token.status_code == 200:
            return Response(ice_token.text, status=200)
        else:
            raise Exception(ice_token.status_code)
    except:
        return Response(traceback.format_exc(), status=400)


# The API route to connect the TTS avatar
@app.route("/api/connectAvatar", methods=["POST"])
def connectAvatar() -> Response:
    global ice_token
    global speech_synthesizer
    try:
        
        speech_config = speechsdk.SpeechConfig(subscription=speech_key, endpoint=f'wss://{speech_region}.tts.speech.microsoft.com/cognitiveservices/websocket/v1?enableTalkingAvatar=true')
        speech_synthesizer = speechsdk.SpeechSynthesizer(speech_config=speech_config, audio_config=None)
        
        ice_token_obj = json.loads(ice_token.text)
        local_sdp = request.headers.get('LocalSdp')
        avatar_character = request.headers.get('AvatarCharacter')
        avatar_style = request.headers.get('AvatarStyle')
        background_color = request.headers.get('BackgroundColor')
        avatar_config = {
            'synthesis': {
                'video': {
                    'protocol': {
                        'name': "WebRTC",
                        'webrtcConfig': {
                            'clientDescription': local_sdp,
                            'iceServers': [{
                                'urls': [ ice_token_obj['Urls'][0] ],
                                'username': ice_token_obj['Username'],
                                'credential': ice_token_obj['Password']
                            }]
                        },
                    },
                    'format':{
                        'crop':{
                            'topLeft':{
                                'x': 0 ,
                                'y': 0
                            },
                            'bottomRight':{
                                'x': 1920 ,
                                'y': 1080
                            }
                        },
                        'bitrate': 2000000
                    },
                    'talkingAvatar': {
                        'character': avatar_character,
                        'style': avatar_style,
                        'background': {
                            'color': background_color
                        }
                    }
                }
            }
        }
        
        connection = speechsdk.Connection.from_speech_synthesizer(speech_synthesizer)
        connection.set_message_property('speech.config', 'context', json.dumps(avatar_config))

        speech_sythesis_result = speech_synthesizer.speak_text_async('').get()
        print(f'Result ID: {speech_sythesis_result.result_id}')
        if speech_sythesis_result.reason == speechsdk.ResultReason.Canceled:
            cancellation_details = speech_sythesis_result.cancellation_details
            print(f"Speech synthesis canceled: {cancellation_details.reason}")
            if cancellation_details.reason == speechsdk.CancellationReason.Error:
                print(f"Error details: {cancellation_details.error_details}")
                raise Exception(cancellation_details.error_details)
        turn_start_message = speech_synthesizer.properties.get_property_by_name('SpeechSDKInternal-ExtraTurnStartMessage')
        remoteSdp = json.loads(turn_start_message)['webrtc']['connectionString']

        return Response(remoteSdp, status=200)
    except Exception as e:
        return Response(f"Result ID: {speech_sythesis_result.result_id}. Error message: {e}", status=400)


# The API route to speak a given SSML
@app.route("/api/speak", methods=["POST"])
def speak() -> Response:
    global speech_synthesizer
    try:
        ssml = request.data.decode('utf-8')
        speech_sythesis_result = speech_synthesizer.speak_ssml_async(ssml).get()
        if speech_sythesis_result.reason == speechsdk.ResultReason.Canceled:
            cancellation_details = speech_sythesis_result.cancellation_details
            print(f"Speech synthesis canceled: {cancellation_details.reason}")
            if cancellation_details.reason == speechsdk.CancellationReason.Error:
                print(f"Error details: {cancellation_details.error_details}")
                raise Exception(cancellation_details.error_details)
        return Response(speech_sythesis_result.result_id, status=200)
    except Exception as e:
        return Response(f"Result ID: {speech_sythesis_result.result_id}. Error message: {e}", status=400)


@app.route('/api/get-latest-message', methods=['GET'])
def get_latest_message():
    query = "SELECT c.message FROM c ORDER BY c._ts DESC OFFSET 0 LIMIT 1"

    try:
        items = list(container.query_items(
            query=query,
            enable_cross_partition_query=True
        ))
        latest_message_content = items[0]['message'] if items else ""
    except exceptions.CosmosHttpResponseError as e:
        return jsonify({"error": str(e)}), e.status_code
    
    # Return only the content of the latest message
    return jsonify({"message": latest_message_content})


@app.route('/convid', methods=['GET'])
def convid():
    secret = os.environ.get('SECRET')
    url = "https://directline.botframework.com/v3/directline/conversations"
    headers = {'Authorization': 'Bearer {}'.format(secret)}
    response = requests.post(url, headers=headers)
    data = response.json()
    conversation_id = data.get("conversationId")
    token = data.get("token")
    expires_in = data.get("expires_in")
    return jsonify({
        "conversation_id": conversation_id,
        "token": token,
        "expires_in": expires_in
    })


# The API route to disconnect the TTS avatar
@app.route("/api/disconnectAvatar", methods=["POST"])
def disconnectAvatar() -> Response:
    global speech_synthesizer
    try:
        connection = speechsdk.Connection.from_speech_synthesizer(speech_synthesizer)
        connection.close()
        return Response('Disconnected avatar', status=200)
    except:
        return Response(traceback.format_exc(), status=400)


def getIceTokenInternal(private_endpoint: str) -> requests.Response:
    if private_endpoint:
        if not private_endpoint.startswith('https://'):
            private_endpoint = f'https://{private_endpoint}'
        ice_token_response = requests.get(f'{private_endpoint}/tts/cognitiveservices/avatar/relay/token/v1', headers={'Ocp-Apim-Subscription-Key': speech_key})
    else:
        ice_token_response = requests.get(f'https://{speech_region}.tts.speech.microsoft.com/cognitiveservices/avatar/relay/token/v1', headers={'Ocp-Apim-Subscription-Key': speech_key})

    return ice_token_response


def recognize_from_microphone():
    # Configuration and recognizer setup here
    speech_config = speechsdk.SpeechConfig(subscription=os.environ['SPEECH_KEY'], region=os.environ['SPEECH_REGION'])
    speech_config.speech_recognition_language = "en-US"
    audio_config = speechsdk.audio.AudioConfig(use_default_microphone=True)
    speech_recognizer = speechsdk.SpeechRecognizer(speech_config=speech_config, audio_config=audio_config)

    # Perform the speech recognition
    speech_recognition_result = speech_recognizer.recognize_once()

    # Check the result and return the appropriate response
    if speech_recognition_result.reason == speechsdk.ResultReason.RecognizedSpeech:
        return speech_recognition_result.text  # Return the recognized text
    elif speech_recognition_result.reason == speechsdk.ResultReason.NoMatch:
        return "No speech could be recognized."
    elif speech_recognition_result.reason == speechsdk.ResultReason.Canceled:
        cancellation_details = speech_recognition_result.cancellation_details
        return f"Speech Recognition canceled: {cancellation_details.reason}. Error details: {cancellation_details.error_details}"
    else:
        return "An unexpected error occurred."


@app.route('/start-recognition', methods=['POST'])
def start_recognition():
    recognized_text = recognize_from_microphone()
    return jsonify({"recognizedText": recognized_text})


if __name__ == '__main__':
    app.run(debug=True)