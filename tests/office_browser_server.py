"""Standalone browser-test server only. Never used by the production app entrypoint."""
import asyncio
import json
import os

import uvicorn
from luma_core.app import app
from luma_core.agents.executor import get_execution_provider
from luma_core.providers.base import ProviderResponse


class FakeProvider:
    is_available = True

    async def chat(self, prompt):
        content = json.loads(prompt.user_content)
        instruction = content['primary_instruction']
        if instruction == 'SLOW':
            await asyncio.sleep(4)
            return ProviderResponse('Late answer must be discarded')
        if instruction == 'HTML_PAYLOAD':
            return ProviderResponse('<img src=x onerror="window.__xss=true">')
        if instruction.startswith('Remember'):
            return ProviderResponse('ACK')
        if 'project' in instruction.lower():
            return ProviderResponse('Aurora' if 'Aurora' in str(content.get('conversation_history')) else 'UNKNOWN')
        return ProviderResponse('Test answer')


if __name__ == '__main__':
    # Only this explicitly launched test process installs the mock dependency.
    app.dependency_overrides[get_execution_provider] = FakeProvider
    from luma_core.routers import chat
    class DirectFake:
        is_available = True
        async def chat(self, prompt, **kwargs):
            return ProviderResponse('Aurora' if 'Aurora' in str(prompt.messages) else 'Direct answer')
    class Registry:
        def get(self): return DirectFake()
    chat.create_registry = lambda settings: Registry()
    from luma_core.routers.images import get_image_provider
    from luma_core.providers.images import ImageResult
    from io import BytesIO
    from PIL import Image, ImageDraw
    class ImageFake:
        available=True
        async def generate(self,prompt,model,quality,ratio,n,reference=None):
            image=Image.new('RGB',(768,432),'#dce8db')
            draw=ImageDraw.Draw(image)
            draw.ellipse((470,40,590,160),fill='#e6bb76')
            draw.polygon([(0,350),(200,150),(420,380)],fill='#496b59')
            draw.polygon([(250,432),(510,200),(768,432)],fill='#7b9b87')
            draw.rectangle((0,390,768,432),fill='#344c40')
            draw.text((28,26),'LUMA STUDIO / MOCK PREVIEW',fill='#344c40')
            if reference: draw.ellipse((110,270,190,350),fill='#d88b6b')
            output=BytesIO(); image.save(output,format='PNG')
            return ImageResult(((output.getvalue(),'image/png'),),model,{'cost':.01})
    app.dependency_overrides[get_image_provider]=ImageFake
    from luma_core.routers import studio
    from luma_core.providers.comfyui import ComfyUI, NODES
    from uuid import uuid4
    class BrowserComfy(ComfyUI):
        async def catalog(self):
            internal={}; models=[]; loras=[]
            for identifier,family,inpaint in [('base','sd15',False),('mask','sd15',True),('xl','sdxl',False)]:
                row={'id':identifier,'file':identifier+'.safetensors','family':family,'display_name':'Mock '+identifier,
                     'version':'fixture-1','ready':True,'available':True,'compatible':True,'inpaint':inpaint,
                     'private_only':False,'adult_content_permitted':True,'license':'Mock test license','source':'Browser test fixture',
                     'requirements':'Optional GPU host; mock test only','verification':'operator-attested'}
                models.append(row);internal[('models',identifier)]=row
            row={'id':'style','file':'style.safetensors','family':'sd15','display_name':'Mock style LoRA','ready':True,
                 'private_only':False,'adult_content_permitted':True,'license':'Mock test license'}
            loras.append(row);internal[('loras','style')]=row
            return {'models':models,'loras':loras,'internal':internal,'nodes':NODES}
        async def upload(self,content,mime):return 'luma/'+str(uuid4())+'.png'
        async def submit(self,graph,job_id):return str(uuid4())
        async def history(self,prompt_id):return {'status':{'completed':True,'status_str':'success'}}
        async def outputs(self,history,model):return await ImageFake().generate('mock',model,'medium','1:1',1)
        async def interrupt(self,prompt_id):return True
    studio.ComfyUI=BrowserComfy
    uvicorn.run(app, host='127.0.0.1', port=int(os.environ['LUMA_UI_TEST_PORT']), access_log=False)
