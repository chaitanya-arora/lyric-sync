from flask import Flask 
from dotenv import load_dotenv
import os 

load_dotenv()

app = Flask(__name__)
app.secret_key = os.urandom(24)

@app.route('/')
def home():
    return 'LyricSync is alive!'

if __name__ == '__main__':
    app.run(debug=True)