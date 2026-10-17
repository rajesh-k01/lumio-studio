import sys, torch, torch.nn as nn, torch.nn.functional as F, importlib.util, numpy as np
spec=importlib.util.spec_from_file_location("rg","/home/claude/lumio/ai/realesrgan.py"); rg=importlib.util.module_from_spec(spec); spec.loader.exec_module(rg)
net=rg.build(torch,nn,F)(); sd=torch.load(sys.argv[1],map_location="cpu",weights_only=True); sd=sd.get("params",sd); net.load_state_dict(sd,strict=True); net.eval()
x=torch.rand(1,3,64,64)
torch.onnx.export(net,x,sys.argv[2],input_names=["x"],output_names=["y"],dynamic_axes={"x":{2:"h",3:"w"},"y":{2:"H",3:"W"}},opset_version=17,dynamo=False)
import onnxruntime as ort
s=ort.InferenceSession(sys.argv[2]); t=torch.rand(1,3,80,96)
a=net(t).detach().numpy(); b=s.run(None,{"x":t.numpy()})[0]; print("max abs diff torch vs onnx:",float(np.abs(a-b).max()), "shape",b.shape)
