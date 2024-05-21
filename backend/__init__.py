import logging
import azure.functions as func
from .app import app as flask_app

def main(req: func.HttpRequest, context: func.Context) -> func.HttpResponse:
    logging.info('Python HTTP trigger function processed a request.')

    from azure.functions._http_wsgi import WsgiMiddleware
    return WsgiMiddleware(flask_app.wsgi_app).handle(req, context)

