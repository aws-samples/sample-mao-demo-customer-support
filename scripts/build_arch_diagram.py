#!/usr/bin/env python3
"""Generate a clean draw.io architecture diagram for the MAC AgentCore demo,
aligned to the actual project (src/backend/lib/stacks + agentcore runtime).

Reuses the official AgentCore icons embedded in the original design-inspector
export (read from the backup so this stays self-contained). Emits a compressed
.drawio/mxfile that opens in diagrams.net and design-inspector.a2z.com.
"""
import base64, html, os, re, urllib.parse, zlib

DOCS = os.path.join(os.path.dirname(__file__), "..", "docs")
BACKUP = os.path.join(DOCS, "jo-AgentCoreMAC.original.bak.xml")

def _load_backup_model():
    raw = open(BACKUP, encoding="utf-8").read()
    payload = re.search(r"<diagram[^>]*>(.*?)</diagram>", raw, re.S).group(1).strip()
    return urllib.parse.unquote(zlib.decompress(base64.b64decode(payload), -15).decode("utf-8"))

_MODEL = _load_backup_model()

def icon(oid):
    m = re.search(r'id="' + re.escape(oid) + r'">\s*<mxCell style="([^"]*)"', _MODEL)
    return m.group(1).strip()

ICON_GATEWAY = icon("73qDg7Sij2uSX8gxzapaP-108")
ICON_IDENTITY = icon("73qDg7Sij2uSX8gxzapaP-109")
ICON_MEMORY = icon("73qDg7Sij2uSX8gxzapaP-110")
ICON_RUNTIME = icon("73qDg7Sij2uSX8gxzapaP-111")
ICON_AGENT = icon("73qDg7Sij2uSX8gxzapaP-112")
ICON_OBSERV = icon("73qDg7Sij2uSX8gxzapaP-113")

S_USER = ("sketch=0;outlineConnect=0;fontColor=#232F3E;gradientColor=none;fillColor=#232F3E;"
          "strokeColor=none;verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;"
          "fontSize=11;shape=mxgraph.networks.user_male;")

def aws20(res, fill, grad):
    return ("sketch=0;points=[[0,0,0],[0.25,0,0],[0.5,0,0],[0.75,0,0],[1,0,0],[0,1,0],[0.25,1,0],"
            "[0.5,1,0],[0.75,1,0],[1,1,0],[0,0.25,0],[0,0.5,0],[0,0.75,0],[1,0.25,0],[1,0.5,0],[1,0.75,0]];"
            f"outlineConnect=0;gradientColor={grad};gradientDirection=north;fillColor={fill};strokeColor=#ffffff;"
            "dashed=0;verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;fontSize=11;fontStyle=0;"
            f"aspect=fixed;shape=mxgraph.aws20.resourceIcon;resIcon=mxgraph.aws20.{res};")

S_CLOUDFRONT = aws20("cloudfront", "#5A30B5", "#945DF2")
S_S3 = aws20("s3", "#277116", "#60A337")
S_COGNITO = aws20("cognito", "#C7131F", "#F54749")
S_LAMBDA = aws20("lambda", "#D05C17", "#F78E04")
S_APPSYNC = aws20("appsync", "#C7131F", "#F54749")
S_DDB = aws20("dynamodb", "#3334B9", "#4D72F3")
S_ATHENA = aws20("athena", "#5A30B5", "#945DF2")
S_GLUE = aws20("glue", "#5A30B5", "#945DF2")
S_KB = aws20("s3", "#277116", "#60A337")
S_WAF = ("sketch=0;gradientColor=#F54749;gradientDirection=north;fillColor=#C7131F;"
         "points=[[0,0],[0.25,0],[0.5,0],[0.75,0],[1,0],[1,0.25],[1,0.5],[1,0.75],[1,1],[0.75,1],[0.5,1],"
         "[0.25,1],[0,1],[0,0.75],[0,0.5],[0,0.25]];outlineConnect=0;strokeColor=#ffffff;dashed=0;"
         "verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;whiteSpace=wrap;fontSize=11;"
         "fontStyle=0;shape=mxgraph.aws4.productIcon;prIcon=mxgraph.aws4.waf;")

def box(fill, stroke, font):
    return (f"rounded=1;whiteSpace=wrap;html=1;arcSize=10;fillColor={fill};strokeColor={stroke};"
            f"fontColor={font};fontSize=10;fontStyle=1;align=center;verticalAlign=middle;spacing=4;")

S_BEDROCK = box("#F2E7FE", "#8C4FFF", "#5A30B5")
S_POLICY = box("#FDE7E9", "#C7131F", "#C7131F")
S_EVAL = box("#E7F3FF", "#0073BB", "#0073BB")
S_CODE = box("#FFF4E5", "#D05C17", "#D05C17")

def group_box(color):
    return (f"rounded=1;arcSize=3;dashed=1;dashPattern=6 4;strokeColor={color};fillColor=none;html=1;"
            f"verticalAlign=top;align=left;fontSize=13;fontStyle=1;fontColor={color};spacingLeft=12;spacingTop=8;")

EDGE = ("endArrow=classic;html=1;rounded=1;edgeStyle=orthogonalEdgeStyle;jettySize=auto;"
        "strokeColor=#5A6C7D;fontSize=10;fontColor=#233;labelBackgroundColor=#FFFFFF;")

cells = []

def node(nid, label, style, x, y, w, h):
    cells.append(
        f'<mxCell id="{nid}" value="{html.escape(label)}" style="{html.escape(style, quote=True)}" '
        f'vertex="1" parent="1"><mxGeometry x="{x}" y="{y}" width="{w}" height="{h}" as="geometry"/></mxCell>'
    )

def edge(eid, src, tgt, label="", extra="", points=None, dashed=False):
    st = EDGE + extra + ("dashed=1;dashPattern=6 4;" if dashed else "")
    geo = '<mxGeometry relative="1" as="geometry">'
    if points:
        geo += '<Array as="points">' + "".join(f'<mxPoint x="{px}" y="{py}"/>' for px, py in points) + "</Array>"
    geo += "</mxGeometry>"
    cells.append(
        f'<mxCell id="{eid}" value="{html.escape(label)}" style="{html.escape(st, quote=True)}" '
        f'edge="1" parent="1" source="{src}" target="{tgt}">{geo}</mxCell>'
    )

# ---------------- Group containers ----------------
node("gFront", "Client / Frontend", group_box("#879196"), 40, 140, 300, 440)
node("gApi", "Streaming API (AppSync)", group_box("#0073BB"), 380, 140, 380, 440)
node("gCore", "Amazon Bedrock AgentCore", group_box("#8C4FFF"), 800, 40, 1120, 620)
node("gTools", "Tools &amp; Data", group_box("#277116"), 800, 720, 1120, 250)

# ---------------- Frontend ----------------
node("user", "End User", S_USER, 95, 250, 48, 58)
node("cognito", "Cognito\nUser Pool", S_COGNITO, 95, 430, 50, 50)
node("cf", "CloudFront", S_CLOUDFRONT, 250, 240, 50, 50)
node("s3site", "S3 Frontend\nWebsite", S_S3, 250, 410, 50, 50)

# ---------------- Streaming API ----------------
node("waf", "WAF", S_WAF, 430, 240, 48, 48)
node("appsync", "AppSync\nGraphQL API", S_APPSYNC, 630, 235, 55, 55)
node("resolver", "Resolver λ\n(sendChat)", S_LAMBDA, 430, 370, 50, 50)
node("memfn", "Memory λ\n(history)", S_LAMBDA, 430, 490, 50, 50)
node("ddb", "DynamoDB\n(Chat/Session)", S_DDB, 640, 370, 55, 55)

# ---------------- AgentCore: Runtime + agents ----------------
node("runtimeBox", "AgentCore Runtime   (ARM64 container • inbound Cognito JWT • X-Ray)",
     group_box("#8C4FFF"), 830, 100, 590, 300)
# Supervisor is the hub on the left; the four specialists form a 2x2 grid to its
# right so the spokes never cross a sibling.
node("agSup", "Supervisor\n(Orchestrator)", ICON_AGENT, 855, 215, 50, 50)
node("agPers", "Personalization", ICON_AGENT, 1040, 150, 50, 50)
node("agProd", "Product Rec.", ICON_AGENT, 1230, 150, 50, 50)
node("agOrder", "Order Mgmt.", ICON_AGENT, 1040, 300, 50, 50)
node("agTs", "Troubleshoot", ICON_AGENT, 1230, 300, 50, 50)

# AgentCore primitives (spaced to the right of the runtime)
node("acMemory", "AgentCore Memory\n(STM + LTM)", ICON_MEMORY, 1500, 120, 50, 50)
node("acGateway", "AgentCore Gateway\n(MCP • OAuth2)", ICON_GATEWAY, 1500, 250, 50, 50)
node("acIdentity", "AgentCore Identity\n(Cognito M2M)", ICON_IDENTITY, 1500, 380, 50, 50)
node("acObserv", "AgentCore\nObservability", ICON_OBSERV, 1740, 120, 50, 50)

# Governance / eval / code interpreter + models (band below the runtime)
node("policy", "Policy / Guardrail\ncontent-safety • PII • prompt-attack", S_POLICY, 880, 450, 180, 64)
node("eval", "Evaluations\nrelevance • completeness • safety", S_EVAL, 1090, 450, 180, 64)
node("code", "Code Interpreter\n(run_code)", S_CODE, 1300, 450, 150, 64)
node("bedrock", "Amazon Bedrock Models\nNova Premier / Pro / Micro / Lite • Claude Sonnet / Haiku",
     S_BEDROCK, 880, 560, 570, 56)

# ---------------- Tools & Data ----------------
# Linear flow left->right (athena_query λ -> Athena -> S3), with Glue hanging
# below Athena so no edge has to jump over a node.
node("athenaLambda", "athena_query λ\n(Gateway target)", S_LAMBDA, 890, 800, 50, 50)
node("athena", "Amazon\nAthena", S_ATHENA, 1110, 800, 55, 55)
node("s3data", "S3 Structured\nData + Results", S_S3, 1350, 800, 50, 50)
node("kb", "S3 Vectors KBs\npersonalization • prod_rec • troubleshoot", S_KB, 1610, 800, 50, 50)
node("glue", "Glue Data\nCatalog", S_GLUE, 1110, 895, 55, 55)

# ---------------- Edges ----------------
# Frontend delivery + auth
edge("e1", "user", "cf", "HTTPS")
edge("e2", "cf", "s3site", "static (OAC)")
edge("e3", "user", "cognito", "sign-in / JWT", dashed=True)
# Frontend -> API
edge("e4", "cf", "waf", "GraphQL")
edge("e5", "waf", "appsync")
edge("e6", "cognito", "appsync", "authz",
     extra="exitX=1;exitY=0.5;exitDx=0;exitDy=0;entryX=0;entryY=0.5;entryDx=0;entryDy=0;",
     points=[(200, 455), (200, 475), (560, 475), (560, 262)], dashed=True)
# API internals
edge("e7", "appsync", "resolver", "sendChat",
     extra="exitX=0;exitY=1;exitDx=0;exitDy=0;entryX=0.5;entryY=0;entryDx=0;entryDy=0;",
     points=[(630, 340), (455, 340)])
edge("e8", "appsync", "memfn", "history",
     extra="exitX=0;exitY=1;exitDx=0;exitDy=0;entryX=1;entryY=0.5;entryDx=0;entryDy=0;",
     points=[(560, 515)])
edge("e9", "appsync", "ddb", "persist")
# Resolver -> Runtime (fixed flow); drop below the DynamoDB row, then up into the runtime
edge("e10", "resolver", "runtimeBox", "invoke (JWT)",
     extra="exitX=0.5;exitY=1;exitDx=0;exitDy=0;entryX=0;entryY=0.5;entryDx=0;entryDy=0;",
     points=[(455, 460), (775, 460), (775, 250)])
# Runtime orchestration — straight hub-and-spoke lines from the Supervisor
for i, tgt in enumerate(("agPers", "agProd", "agOrder", "agTs")):
    edge(f"e11{i}", "agSup", tgt, "", extra="edgeStyle=none;rounded=0;strokeColor=#8C4FFF;endArrow=classic;")
# Runtime -> primitives / models
edge("e15", "runtimeBox", "acMemory", "r/w",
     extra="exitX=1;exitY=0.15;exitDx=0;exitDy=0;entryX=0;entryY=0.5;entryDx=0;entryDy=0;")
edge("e16", "runtimeBox", "acGateway", "MCP call",
     extra="exitX=1;exitY=0.6;exitDx=0;exitDy=0;entryX=0;entryY=0.5;entryDx=0;entryDy=0;")
edge("e17", "acGateway", "acIdentity", "token", dashed=True)
edge("e18", "runtimeBox", "acObserv", "traces",
     extra="exitX=1;exitY=0;exitDx=0;exitDy=0;entryX=0;entryY=0.5;entryDx=0;entryDy=0;",
     points=[(1450, 90)], dashed=True)
# Bedrock model invocation: route down the far-left channel (left of the policy box)
edge("e19", "runtimeBox", "bedrock", "InvokeModel*",
     extra="exitX=0;exitY=0.9;exitDx=0;exitDy=0;entryX=0;entryY=0.5;entryDx=0;entryDy=0;",
     points=[(805, 370), (805, 588)])
edge("e20", "runtimeBox", "policy", "per-turn",
     extra="exitX=0.3;exitY=1;exitDx=0;exitDy=0;entryX=0.5;entryY=0;entryDx=0;entryDy=0;")
edge("e21", "policy", "eval", "then")
edge("e22", "runtimeBox", "code", "run_code",
     extra="exitX=0.78;exitY=1;exitDx=0;exitDy=0;entryX=0.5;entryY=0;entryDx=0;entryDy=0;",
     points=[(1290, 425)])
# Memory lambda -> memory (history read); route across the top, above the agents
edge("e23", "memfn", "acMemory", "List*",
     extra="exitX=1;exitY=0.5;exitDx=0;exitDy=0;entryX=0.5;entryY=0;entryDx=0;entryDy=0;",
     points=[(790, 515), (790, 66), (1525, 66)], dashed=True)
# Gateway -> athena lambda -> data (routed through the corridor between AgentCore and Tools)
edge("e24", "acGateway", "athenaLambda", "target",
     extra="exitX=1;exitY=0.5;exitDx=0;exitDy=0;entryX=0.5;entryY=0;entryDx=0;entryDy=0;",
     points=[(1600, 275), (1600, 690), (915, 690)])
edge("e25", "athenaLambda", "athena", "query")
edge("e26", "athena", "glue", "schema")   # Glue sits directly below Athena
edge("e27", "athena", "s3data", "read / results")
# Runtime -> KBs
edge("e28", "runtimeBox", "kb", "Retrieve",
     extra="exitX=1;exitY=1;exitDx=0;exitDy=0;entryX=0.5;entryY=0;entryDx=0;entryDy=0;",
     points=[(1470, 400), (1470, 700), (1635, 700)])

# ---------------- Assemble ----------------
model = ('<mxGraphModel dx="1400" dy="900" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" '
         'arrows="1" fold="1" page="1" pageScale="1" pageWidth="2000" pageHeight="1050" math="0" shadow="0">'
         '<root><mxCell id="0"/><mxCell id="1" parent="0"/>'
         + "".join(cells) + '</root></mxGraphModel>')

quoted = urllib.parse.quote(model, safe="")
deflator = zlib.compressobj(9, zlib.DEFLATED, -15)
payload = base64.b64encode(deflator.compress(quoted.encode("utf-8")) + deflator.flush()).decode("ascii")
out = ('<?xml version="1.0" encoding="UTF-8"?>\n'
       '<mxfile host="app.diagrams.net" type="device" version="24.0.0">'
       '<diagram id="agentcore-mac" name="AgentCore MAC">' + payload + '</diagram></mxfile>\n')

outpath = os.path.join(DOCS, "jo-AgentCoreMAC.xml")
open(outpath, "w", encoding="utf-8").write(out)
print("wrote", outpath, "| cells:", len(cells))
